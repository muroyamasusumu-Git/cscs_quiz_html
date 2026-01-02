#!/usr/bin/env python3
# local_protocol_tool.py
# -*- coding: utf-8 -*-

import json
import hashlib
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import List, Tuple, Optional


# ============================================================
# 設定（必要ならここだけ変えればOK）
# ============================================================
DEFAULT_PREFIX = "CSCSJS"
DEFAULT_LANG = "javascript"
DEFAULT_MAXCHARS = 60000
DEFAULT_MAXLINES = 1200

# extract（抽出）設定（必要ならここだけ変えればOK）
DEFAULT_EXTRACT_CONTEXT_LINES = 25
DEFAULT_EXTRACT_MAX_MATCHES = 50

# split モード:
#   C = 通常（現状）
#   A = IIFE終端優先（上限は“目安”扱い寄り）
#   B = IIFE終端優先だが、一定距離内に無ければ妥協して改行分割（ハイブリッド）
DEFAULT_SPLIT_MODE = "C"

# モードBの「粘る」距離（maxchars に対する比率）
# 例: 0.30 → 上限から +30% まで IIFE終端を探す
DEFAULT_IIFE_GRACE_RATIO = 0.30

# ローカル出力先（このスクリプトが置かれているフォルダ基準）
DEFAULT_OUTROOT = "out_protocol_local_tool"

# out_protocol_local_tool 配下に保持する RUN ディレクトリ数（ログ保持数）
# 超過分は「古い順」に自動削除する
DEFAULT_MAX_LOG_DIRS = 50

# ブラウザからのアクセスをローカルのみに限定（念のため）
BIND_HOST = "127.0.0.1"
BIND_PORT = 8787

EXEC_TASK_PATCH_RULES = """【出力仕様（パッチ規約：厳守）】
- 参照元のコードから「確実に検索できる」形で提示すること（検索しやすい連続行を含める）
- 必ず参照元と「同じインデント」で提示すること
- 「置換前／置換後」を明確に分けること（それぞれ別のコードブロック）
- 「...」「（中略）」「省略」などの省略表現は禁止（置換対象行は省略なし）
- 出力は「フル」ではなく「置換部分のみ」
- 置換前コードブロック内に「参照元本文に無いコメント」を追加しないこと
- フォールバックの設定・保険・自動互換コードの追加は基本的に禁止（必要なら理由と影響を明示して停止し確認を取る）
- 追加した処理には、処理ごとに『何をしているか』の補足コメントを置換後側に入れること
"""


@dataclass
class SplitPart:
    index: int
    total: int
    part_id: str
    text: str
    start_offset: int
    end_offset: int

    # PART_SCOPE_HINT 用（人間＆ChatGPTが素早く探索できるようにする）
    start_line: int
    end_line: int
    brace_depth_start: int
    brace_depth_end: int

    # このパート本文の SHA256（貼り間違い・改ざん検出用）
    part_sha256: str

    # 人間が貼り間違いに気づくための可視ヒント
    first_line: str
    last_line: str


def sha256_hex(s: str) -> str:
    h = hashlib.sha256()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


def sha256_8(s: str) -> str:
    return sha256_hex(s)[:8].upper()


def build_request_id(project_id: str, task_id: str, instruction: str) -> str:
    """
    依頼ごとの共通ID（REQUEST_ID）を作る。
    - instruction（指示文）からSHA8を作るので、同じ指示なら同じIDになりやすい
    - project/task も混ぜて、衝突確率を下げる
    """
    p = str(project_id or "").strip()
    t = str(task_id or "").strip()
    ins = str(instruction or "")
    base = f"{p}\n{t}\n{ins}"
    return f"REQ-{sha256_8(base)}"


def wrap_instruction_with_ids(
    instruction: str,
    session_id: str,
    project_id: str,
    task_id: str,
    include_rules: bool,
) -> Tuple[str, str]:
    """
    instruction を「貼り付け用フォーマット」に整形して返す。
    戻り値: (wrapped_instruction, request_id)
    """
    ins = str(instruction or "").strip()
    p = str(project_id or "").strip()
    t = str(task_id or "").strip()

    request_id = build_request_id(p, t, ins)

    lines: List[str] = []
    lines.append("【WORK_HEADER（共通ID）】")
    if p != "":
        lines.append(f"[PROJECT: {p}]")
    if t != "":
        lines.append(f"[TASK: {t}]")
    lines.append(f"[SESSION_ID: {session_id}]")
    lines.append(f"[REQUEST_ID: {request_id}]")
    lines.append("")

    lines.append("【USER_INSTRUCTION】")
    if ins != "":
        lines.append(ins)
    else:
        lines.append("（指示が空です）")

    if include_rules:
        lines.append("")
        lines.append("【PATCH_RULES（いつものルール）】")
        lines.append(EXEC_TASK_PATCH_RULES.rstrip())

    return ("\n".join(lines).strip() + "\n", request_id)


def _part_top_identifiers(js_chunk: str, top_n: int) -> List[Tuple[str, int]]:
    """
    パート本文から頻出識別子 TopN を返す（簡易）
    - ASTは使わない（依存ゼロ・速度優先）
    - JS予約語は除外
    """
    s = str(js_chunk or "")

    import re
    from collections import Counter

    try:
        n = int(top_n)
    except Exception:
        n = 0
    if n <= 0:
        n = 12

    tokens = re.findall(r"\b[A-Za-z_$][A-Za-z0-9_$]*\b", s)

    reserved = {
        "await","break","case","catch","class","const","continue","debugger","default","delete",
        "do","else","enum","export","extends","false","finally","for","function","if","import",
        "in","instanceof","let","new","null","return","super","switch","this","throw","true",
        "try","typeof","var","void","while","with","yield",
        "implements","interface","package","private","protected","public","static",
    }

    ident_list = [t for t in tokens if t and t not in reserved]
    c = Counter(ident_list)
    return c.most_common(n)


def _part_defines(js_chunk: str, max_items: int) -> List[str]:
    """
    パート本文内の「定義」っぽい名前を抽出（簡易）
    - function NAME(
    - async function NAME(
    - function* NAME(
    - class NAME
    - var/let/const NAME =
    """
    s = str(js_chunk or "")

    import re

    try:
        mx = int(max_items)
    except Exception:
        mx = 0
    if mx <= 0:
        mx = 40

    names: List[str] = []

    patterns = [
        re.compile(r"(^|\n)\s*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*async\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*function\s*\*\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*async\s+function\s*\*\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b", re.MULTILINE),
        re.compile(r"(^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=", re.MULTILINE),
    ]

    seen = set()

    for rg in patterns:
        for m in rg.finditer(s):
            nm = str(m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)).strip()
            if nm == "":
                continue
            if nm not in seen:
                seen.add(nm)
                names.append(nm)
                if len(names) >= mx:
                    return names

    return names


def make_session_id(prefix: str, file_text: str) -> str:
    digest8 = sha256_hex(file_text)[:8].upper()
    return f"{prefix}-{digest8}"


def safe_mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def split_by_limits(
    text: str,
    max_chars: int,
    max_lines: int,
    split_mode: str = "C",
    iife_grace_ratio: float = 0.30,
) -> List[Tuple[int, int, str, int, int]]:
    if max_chars <= 0:
        raise ValueError("max_chars must be > 0")
    if max_lines <= 0:
        raise ValueError("max_lines must be > 0")

    mode = str(split_mode or "C").strip().upper()
    if mode not in ("A", "B", "C"):
        mode = "C"

    try:
        grace = float(iife_grace_ratio)
    except Exception:
        grace = 0.30
    if not (grace >= 0.0):
        grace = 0.30

    n = len(text)
    if n == 0:
        return [(0, 0, "")]

    parts: List[Tuple[int, int, str, int, int]] = []
    start = 0

    # ============================================================
    # ブレース深さトラッキング（PART_SCOPE_HINT / depth==0境界 用）
    # - 文字列 / テンプレ / コメント を極力避けて数える（簡易）。
    # - splitは先頭→末尾へ進むので、状態は継続して持つ（チャンク跨ぎ対応）。
    # ============================================================
    depth = 0
    in_squote = False
    in_dquote = False
    in_tpl = False
    in_line_cmt = False
    in_block_cmt = False
    esc = False

    # IIFE終端として扱う候補（モードA/Bはこれだけを“強く”探す）
    iife_tokens = [
        "\n})();\n",
        "})();\n",
        "\n})();",
        "})();",
    ]

    while start < n:
        # ------------------------------------------------------------
        # 連続行（1行）をパート境界で絶対に切らないための補助関数
        # ------------------------------------------------------------
        def _snap_end_to_newline(start_pos: int, end_pos: int) -> int:
            """
            end_pos を「改行境界（\\n の直後）」へ丸める。
            - 行の途中で分割しないことを保証する。
            - end_pos が行途中なら、次の \\n まで前進して含める（見つからなければ n）。
            - start_pos と同じ位置に戻ってしまう場合は、最低でも次の改行または n へ進める。
            """
            e = int(end_pos)
            if e <= start_pos:
                # ここで止まると無限ループになるため、必ず前進させる
                nl2 = text.find("\n", start_pos, n)
                if nl2 != -1:
                    return nl2 + 1
                return n

            if e >= n:
                return n

            # すでに改行境界（直前が \n）ならそのまま
            if text[e - 1] == "\n":
                return e

            # 行途中なら、次の改行まで進めて「改行を含める」
            nl = text.find("\n", e, n)
            if nl != -1:
                return nl + 1

            # もう改行が無い（= 最終行が超長行など）なら末尾まで
            return n

        end_by_chars = min(start + max_chars, n)

        end_by_lines = n
        if start < n:
            pos = start
            newlines = 0
            while True:
                nl = text.find("\n", pos, n)
                if nl == -1:
                    end_by_lines = n
                    break
                newlines += 1
                if newlines >= max_lines:
                    end_by_lines = nl + 1
                    break
                pos = nl + 1

        tentative_end = min(end_by_chars, end_by_lines)

        if tentative_end == n:
            end = n
        else:
            # ============================================================
            # 分割戦略（A/B/C）
            # ------------------------------------------------------------
            # A: IIFE終端優先 + 上限は“目安”に降格（巨大IIFEは巨大パートになり得る）
            # B: IIFE終端を +grace まで探し、無ければ妥協して改行分割
            # C: 現状（複数の境界候補→無ければ改行優先）
            # ============================================================

            if mode in ("A", "B"):
                if mode == "A":
                    search_from = tentative_end
                    search_to = n
                else:
                    extra = int(max_chars * grace)
                    if extra < 0:
                        extra = 0
                    search_from = tentative_end
                    search_to = min(tentative_end + extra, n)

                found_end = -1
                best_pos = -1
                best_len = 0

                for token in iife_tokens:
                    pos = text.find(token, search_from, search_to)
                    if pos != -1:
                        if best_pos == -1 or pos < best_pos:
                            best_pos = pos
                            best_len = len(token)

                if best_pos != -1:
                    found_end = best_pos + best_len

                if found_end != -1:
                    end = found_end
                else:
                    # IIFE終端が見つからない場合の扱い
                    # A: ファイル末尾までに見つからないなら、仕方ないので従来の改行優先へ戻す
                    # B: 既定どおり妥協して改行優先へ戻す
                    nl = text.rfind("\n", start, tentative_end)
                    if nl == -1 or nl <= start:
                        end = tentative_end
                    else:
                        end = nl + 1

            else:
                # --- 境界優先分割（Cモード：改良版） ---
                # 優先順位:
                #   1) depth==0 の「改行境界」（構文的に自立しやすい）
                #   2) 従来の boundary_candidates（終端っぽいトークン）
                #   3) 最後の改行（従来どおり）
                def _find_last_depth0_newline(start_pos: int, end_pos: int) -> int:
                    """
                    start_pos..end_pos で、brace depth==0 の位置にある「改行境界（\\n の直後）」のうち、
                    最後の地点を返す。見つからなければ -1。
                    ※簡易スキャナ。文字列/テンプレ/コメント内の { } は数えない。
                    """
                    i = start_pos
                    n2 = end_pos

                    d = 0
                    sq = False
                    dq = False
                    tp = False
                    lc = False
                    bc = False
                    es = False

                    last_cut = -1

                    while i < n2:
                        ch = text[i]

                        if lc:
                            if ch == "\n":
                                lc = False
                                if d == 0:
                                    last_cut = i + 1
                            i += 1
                            continue

                        if bc:
                            if ch == "*" and i + 1 < n2 and text[i + 1] == "/":
                                bc = False
                                i += 2
                                continue
                            i += 1
                            continue

                        if sq:
                            if es:
                                es = False
                                i += 1
                                continue
                            if ch == "\\":
                                es = True
                                i += 1
                                continue
                            if ch == "'":
                                sq = False
                            i += 1
                            continue

                        if dq:
                            if es:
                                es = False
                                i += 1
                                continue
                            if ch == "\\":
                                es = True
                                i += 1
                                continue
                            if ch == '"':
                                dq = False
                            i += 1
                            continue

                        if tp:
                            if es:
                                es = False
                                i += 1
                                continue
                            if ch == "\\":
                                es = True
                                i += 1
                                continue
                            if ch == "`":
                                tp = False
                            i += 1
                            continue

                        # 文字列/コメント外
                        if ch == "/" and i + 1 < n2 and text[i + 1] == "/":
                            lc = True
                            i += 2
                            continue
                        if ch == "/" and i + 1 < n2 and text[i + 1] == "*":
                            bc = True
                            i += 2
                            continue
                        if ch == "'":
                            sq = True
                            i += 1
                            continue
                        if ch == '"':
                            dq = True
                            i += 1
                            continue
                        if ch == "`":
                            tp = True
                            i += 1
                            continue

                        if ch == "{":
                            d += 1
                            i += 1
                            continue
                        if ch == "}":
                            d -= 1
                            if d < 0:
                                d = 0
                            i += 1
                            continue

                        if ch == "\n":
                            if d == 0:
                                last_cut = i + 1
                            i += 1
                            continue

                        i += 1

                    return last_cut

                boundary_candidates = [
                    "\n})();\n",
                    "\n});\n",
                    "\n}\n",
                ]

                # 1) depth==0 の改行境界（後ろ寄り）を優先（探索は重くしないため、末尾寄り窓で見る）
                depth0_found = -1
                depth0_search_from = max(start, tentative_end - 12000)
                depth0_search_to = tentative_end
                pos0 = _find_last_depth0_newline(depth0_search_from, depth0_search_to)
                if pos0 != -1 and pos0 > start:
                    depth0_found = pos0

                if depth0_found != -1:
                    end = depth0_found
                else:
                    # 2) 従来の終端っぽいトークン
                    boundary_found = -1
                    search_from = max(start, tentative_end - 2000)
                    search_to = tentative_end

                    for token in boundary_candidates:
                        pos = text.rfind(token, search_from, search_to)
                        if pos != -1:
                            boundary_found = pos + len(token)
                            break

                    if boundary_found != -1:
                        end = boundary_found
                    else:
                        # 3) 最後の改行
                        nl = text.rfind("\n", start, tentative_end)
                        if nl == -1 or nl <= start:
                            end = tentative_end
                        else:
                            end = nl + 1

            # ★ 追加した処理: 最終的な end は必ず「改行境界」に丸めて、行の途中で切らない
            end = _snap_end_to_newline(start, end)

        # ============================================================
        # このパートの brace depth（開始→終了）を確定
        # - split は先頭→末尾へ進むため、状態を引き継いで正確性を上げる
        # ============================================================
        depth_start = depth

        i = start
        while i < end:
            ch = text[i]

            if in_line_cmt:
                if ch == "\n":
                    in_line_cmt = False
                i += 1
                continue

            if in_block_cmt:
                if ch == "*" and i + 1 < end and text[i + 1] == "/":
                    in_block_cmt = False
                    i += 2
                    continue
                i += 1
                continue

            if in_squote:
                if esc:
                    esc = False
                    i += 1
                    continue
                if ch == "\\":
                    esc = True
                    i += 1
                    continue
                if ch == "'":
                    in_squote = False
                i += 1
                continue

            if in_dquote:
                if esc:
                    esc = False
                    i += 1
                    continue
                if ch == "\\":
                    esc = True
                    i += 1
                    continue
                if ch == '"':
                    in_dquote = False
                i += 1
                continue

            if in_tpl:
                if esc:
                    esc = False
                    i += 1
                    continue
                if ch == "\\":
                    esc = True
                    i += 1
                    continue
                if ch == "`":
                    in_tpl = False
                i += 1
                continue

            # 文字列/コメント外
            if ch == "/" and i + 1 < end and text[i + 1] == "/":
                in_line_cmt = True
                i += 2
                continue
            if ch == "/" and i + 1 < end and text[i + 1] == "*":
                in_block_cmt = True
                i += 2
                continue
            if ch == "'":
                in_squote = True
                i += 1
                continue
            if ch == '"':
                in_dquote = True
                i += 1
                continue
            if ch == "`":
                in_tpl = True
                i += 1
                continue

            if ch == "{":
                depth += 1
                i += 1
                continue
            if ch == "}":
                depth -= 1
                if depth < 0:
                    depth = 0
                i += 1
                continue

            i += 1

        depth_end = depth

        chunk = text[start:end]
        parts.append((start, end, chunk, depth_start, depth_end))
        start = end

    return parts


def build_part_id(session_id: str, idx: int, total: int) -> str:
    return f"{session_id}-P{idx:02d}-of-{total:02d}"


def _line_start_offsets(s: str) -> List[int]:
    """
    各行の開始オフセット配列を作る（行番号→オフセット変換用）
    """
    offs = [0]
    i = 0
    n = len(s)
    while i < n:
        j = s.find("\n", i)
        if j == -1:
            break
        offs.append(j + 1)
        i = j + 1
    return offs


def _offset_to_line_index(line_starts: List[int], offset: int) -> int:
    """
    offset が属する行（0-based）を返す
    """
    lo = 0
    hi = len(line_starts) - 1
    if hi < 0:
        return 0
    if offset <= 0:
        return 0
    if offset >= line_starts[hi]:
        # 最終行以降は最終行扱い
        return hi

    while lo <= hi:
        mid = (lo + hi) // 2
        a = line_starts[mid]
        b = line_starts[mid + 1] if mid + 1 < len(line_starts) else 10**18
        if a <= offset < b:
            return mid
        if offset < a:
            hi = mid - 1
        else:
            lo = mid + 1
    return max(0, min(len(line_starts) - 1, lo))


def _find_matching_brace_end(s: str, start_pos: int) -> int:
    """
    start_pos 以降で最初に現れる '{' を起点に、対応する '}' の直後位置を返す。
    - 文字列 / テンプレ / コメント を極力避けて数える（簡易）。
    - 見つからない場合は -1。
    """
    n = len(s)
    i = start_pos

    # 1) まず最初の '{' を探す（コメント/文字列はざっくりスキップ）
    in_squote = False
    in_dquote = False
    in_tpl = False
    in_line_cmt = False
    in_block_cmt = False
    esc = False

    while i < n:
        ch = s[i]

        if in_line_cmt:
            if ch == "\n":
                in_line_cmt = False
            i += 1
            continue

        if in_block_cmt:
            if ch == "*" and i + 1 < n and s[i + 1] == "/":
                in_block_cmt = False
                i += 2
                continue
            i += 1
            continue

        if in_squote:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == "'":
                in_squote = False
            i += 1
            continue

        if in_dquote:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == '"':
                in_dquote = False
            i += 1
            continue

        if in_tpl:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == "`":
                in_tpl = False
            i += 1
            continue

        # 文字列/コメント外
        if ch == "/" and i + 1 < n and s[i + 1] == "/":
            in_line_cmt = True
            i += 2
            continue
        if ch == "/" and i + 1 < n and s[i + 1] == "*":
            in_block_cmt = True
            i += 2
            continue
        if ch == "'":
            in_squote = True
            i += 1
            continue
        if ch == '"':
            in_dquote = True
            i += 1
            continue
        if ch == "`":
            in_tpl = True
            i += 1
            continue

        if ch == "{":
            break

        i += 1

    if i >= n or s[i] != "{":
        return -1

    # 2) 対応する '}' を探す
    depth = 0
    in_squote = False
    in_dquote = False
    in_tpl = False
    in_line_cmt = False
    in_block_cmt = False
    esc = False

    while i < n:
        ch = s[i]

        if in_line_cmt:
            if ch == "\n":
                in_line_cmt = False
            i += 1
            continue

        if in_block_cmt:
            if ch == "*" and i + 1 < n and s[i + 1] == "/":
                in_block_cmt = False
                i += 2
                continue
            i += 1
            continue

        if in_squote:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == "'":
                in_squote = False
            i += 1
            continue

        if in_dquote:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == '"':
                in_dquote = False
            i += 1
            continue

        if in_tpl:
            if esc:
                esc = False
                i += 1
                continue
            if ch == "\\":
                esc = True
                i += 1
                continue
            if ch == "`":
                in_tpl = False
            i += 1
            continue

        # 文字列/コメント外
        if ch == "/" and i + 1 < n and s[i + 1] == "/":
            in_line_cmt = True
            i += 2
            continue
        if ch == "/" and i + 1 < n and s[i + 1] == "*":
            in_block_cmt = True
            i += 2
            continue
        if ch == "'":
            in_squote = True
            i += 1
            continue
        if ch == '"':
            in_dquote = True
            i += 1
            continue
        if ch == "`":
            in_tpl = True
            i += 1
            continue

        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            i += 1
            if depth == 0:
                return i
            continue

        i += 1

    return -1


def extract_function_whole(js_text: str, name: str) -> Tuple[bool, str, str]:
    """
    関数 “まるごと” 抽出（簡易）
    - function NAME(...) {...}
    - var NAME = function(...) {...}
    - const NAME = (...) => {...}
    - let NAME = (...) => {...}
    戻り値: (found, header, body)
    """
    s = str(js_text or "")
    target = str(name or "").strip()
    if target == "":
        return (False, "name is empty", "")

    import re

    patterns = [
        # 追加した処理: async / export / export default / generator 付きの関数宣言も拾う（現実のJSで頻出）
        re.compile(r"(^|\n)\s*(?:export\s+default\s+)?(?:export\s+)?function\s+" + re.escape(target) + r"\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*(?:export\s+default\s+)?(?:export\s+)?async\s+function\s+" + re.escape(target) + r"\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*(?:export\s+default\s+)?(?:export\s+)?function\s*\*\s*" + re.escape(target) + r"\s*\(", re.MULTILINE),
        re.compile(r"(^|\n)\s*(?:export\s+default\s+)?(?:export\s+)?async\s+function\s*\*\s*" + re.escape(target) + r"\s*\(", re.MULTILINE),

        # 既存: 通常の function NAME( ももちろん拾う（上の export 系で拾えないケースの保険ではなく、素直な網羅）
        re.compile(r"(^|\n)\s*function\s+" + re.escape(target) + r"\s*\(", re.MULTILINE),

        # 既存: var/let/const NAME = function(
        re.compile(r"(^|\n)\s*(?:var|let|const)\s+" + re.escape(target) + r"\s*=\s*function\s*\(", re.MULTILINE),

        # 既存: var/let/const NAME = (...) => { / NAME = x => { （ブロックarrowのみ = “まるごと”抽出できる）
        re.compile(r"(^|\n)\s*(?:var|let|const)\s+" + re.escape(target) + r"\s*=\s*\([^)]*\)\s*=>\s*{", re.MULTILINE),
        re.compile(r"(^|\n)\s*(?:var|let|const)\s+" + re.escape(target) + r"\s*=\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=>\s*{", re.MULTILINE),
    ]

    best = None
    for rg in patterns:
        m = rg.search(s)
        if m:
            best = m
            break

    if not best:
        return (False, "not found", "")

    start_pos = best.start(0)
    # start_pos が "\n" を含むマッチの場合、行頭から取る
    if start_pos > 0 and s[start_pos] == "\n":
        start_pos = start_pos + 1

    end_pos = _find_matching_brace_end(s, best.end(0))
    if end_pos == -1:
        return (False, "found start but brace not closed", "")

    body = s[start_pos:end_pos]
    header = f"EXTRACT_FUNCTION: {target} (chars {start_pos}..{end_pos})"
    return (True, header, body)


def extract_context_around(js_text: str, needle: str, context_lines: int, max_matches: int) -> Tuple[int, List[Tuple[str, str]]]:
    """
    文字列 needle のヒット行を中心に ±context_lines 行を抽出する。
    戻り値: (hit_count, blocks[(header, body)])
    """
    s = str(js_text or "")
    nd = str(needle or "")
    try:
        ctx = int(context_lines)
    except Exception:
        ctx = DEFAULT_EXTRACT_CONTEXT_LINES
    if ctx < 0:
        ctx = 0

    try:
        mm = int(max_matches)
    except Exception:
        mm = DEFAULT_EXTRACT_MAX_MATCHES
    if mm <= 0:
        mm = DEFAULT_EXTRACT_MAX_MATCHES

    line_starts = _line_start_offsets(s)
    lines = s.splitlines(True)

    blocks: List[Tuple[str, str]] = []
    hit_count = 0

    pos = 0
    n = len(s)
    while pos < n:
        j = s.find(nd, pos)
        if j == -1:
            break

        hit_count += 1
        if hit_count <= mm:
            li = _offset_to_line_index(line_starts, j)
            a = max(0, li - ctx)
            b = min(len(lines), li + ctx + 1)

            body = "".join(lines[a:b])
            header = f"EXTRACT_CONTEXT: '{nd}' hit_line={li + 1} range_lines={a + 1}..{b}"
            blocks.append((header, body))

        pos = j + max(1, len(nd))

        if hit_count >= mm:
            # max_matches 以上はカウントだけ進めず終了
            break

    return (hit_count, blocks)


def build_expected_partids(parts: List[SplitPart]) -> List[str]:
    return [p.part_id for p in parts]


def build_cumulative_partids(parts: List[SplitPart], upto_index_inclusive: int) -> List[str]:
    return [p.part_id for p in parts if p.index <= upto_index_inclusive]


def build_scope_index_block(full_js_text: str) -> str:
    """
    連結後JS（= 元のフルJS）に「探索用の索引」を埋め込む。

    目的:
      - ChatGPT が全文探索せずとも、SCOPE_INDEX を見て「ある/ない」を先に確定できるようにする。
      - 見落とし由来の「無い判定」や「追加要求」を減らす。
      - 文字列由来の重要情報（DOM id / CSS selector / localStorage key 等）も索引化し、検索コストを下げる。

    方針:
      - 厳密な構文解析（AST）はしない（速度優先・依存ゼロ）。
      - 「存在確認/検索補助」用途に徹し、過剰な出力は上限で抑える。
    """
    s = str(full_js_text or "")

    import re
    from collections import Counter

    # ----------------------------
    # 1) JS識別子（宣言/参照問わず）
    # ----------------------------
    tokens = re.findall(r"\b[A-Za-z_$][A-Za-z0-9_$]*\b", s)

    reserved = {
        "await","break","case","catch","class","const","continue","debugger","default","delete",
        "do","else","enum","export","extends","false","finally","for","function","if","import",
        "in","instanceof","let","new","null","return","super","switch","this","throw","true",
        "try","typeof","var","void","while","with","yield",
        "implements","interface","package","private","protected","public","static",
    }

    ident_list = [t for t in tokens if t and t not in reserved]
    ident_counter = Counter(ident_list)
    ident_uniq = sorted(set(ident_list))

    # ----------------------------
    # 2) DOM / selector / localStorage key（文字列抽出）
    #    ※「見落としやすいが、実作業で必要になりがち」なので索引化する
    # ----------------------------
    def _uniq_sorted(xs):
        return sorted({str(x) for x in xs if str(x).strip() != ""})

    # getElementById("...") / getElementsByClassName("...") / getElementsByName("...")
    dom_ids = re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", s)
    dom_classes = re.findall(r"getElementsByClassName\(\s*['\"]([^'\"]+)['\"]\s*\)", s)
    dom_names = re.findall(r"getElementsByName\(\s*['\"]([^'\"]+)['\"]\s*\)", s)

    # querySelector("...") / querySelectorAll("...")
    qs_1 = re.findall(r"querySelector\(\s*['\"]([^'\"]+)['\"]\s*\)", s)
    qs_all = re.findall(r"querySelectorAll\(\s*['\"]([^'\"]+)['\"]\s*\)", s)

    # localStorage/sessionStorage keys
    ls_get = re.findall(r"localStorage\.getItem\(\s*['\"]([^'\"]+)['\"]\s*\)", s)
    ls_set = re.findall(r"localStorage\.setItem\(\s*['\"]([^'\"]+)['\"]\s*,", s)
    ls_rm = re.findall(r"localStorage\.removeItem\(\s*['\"]([^'\"]+)['\"]\s*\)", s)

    ss_get = re.findall(r"sessionStorage\.getItem\(\s*['\"]([^'\"]+)['\"]\s*\)", s)
    ss_set = re.findall(r"sessionStorage\.setItem\(\s*['\"]([^'\"]+)['\"]\s*,", s)
    ss_rm = re.findall(r"sessionStorage\.removeItem\(\s*['\"]([^'\"]+)['\"]\s*\)", s)

    dom_ids_u = _uniq_sorted(dom_ids)
    dom_classes_u = _uniq_sorted(dom_classes)
    dom_names_u = _uniq_sorted(dom_names)
    qs_1_u = _uniq_sorted(qs_1)
    qs_all_u = _uniq_sorted(qs_all)

    ls_keys_u = _uniq_sorted(ls_get + ls_set + ls_rm)
    ss_keys_u = _uniq_sorted(ss_get + ss_set + ss_rm)

    # ----------------------------
    # 3) 出力（上限付き）
    # ----------------------------
    MAX_IDENTIFIERS = 6000
    MAX_DOM = 1500
    MAX_SELECTORS = 1500
    MAX_KEYS = 2000

    lines: List[str] = []
    lines.append("【SCOPE_INDEX（連結後JSの探索用索引）】")
    lines.append("・この索引は、分割前の元JS全文（= 連結後JS）から抽出しています。")
    lines.append("・まずここを見て「存在する/しない」を確定し、不要な全文探索や見落としを減らしてください。")
    lines.append("・識別子だけでなく DOM/selector/storage key も含めています。")
    lines.append("")

    # 概要
    lines.append("【SUMMARY】")
    lines.append(f"TOTAL_IDENTIFIERS_UNIQ: {len(ident_uniq)}")
    lines.append(f"TOTAL_DOM_IDS_UNIQ: {len(dom_ids_u)}")
    lines.append(f"TOTAL_DOM_CLASSES_UNIQ: {len(dom_classes_u)}")
    lines.append(f"TOTAL_DOM_NAMES_UNIQ: {len(dom_names_u)}")
    lines.append(f"TOTAL_SELECTORS_UNIQ: {len(sorted(set(qs_1_u + qs_all_u)))}")
    lines.append(f"TOTAL_LOCALSTORAGE_KEYS_UNIQ: {len(ls_keys_u)}")
    lines.append(f"TOTAL_SESSIONSTORAGE_KEYS_UNIQ: {len(ss_keys_u)}")
    lines.append("")

    # よく出てくる識別子（ChatGPTが「重要っぽいのに見落とす」パターンを減らす）
    lines.append("【IDENTIFIERS_TOP_FREQUENT（頻出上位）】")
    for name, cnt in ident_counter.most_common(80):
        lines.append(f"- {name} ({cnt})")
    lines.append("")

    # 識別子一覧
    lines.append("【IDENTIFIERS_ALL（ユニーク識別子一覧）】")
    if len(ident_uniq) <= MAX_IDENTIFIERS:
        for name in ident_uniq:
            lines.append(f"- {name}")
    else:
        head = ident_uniq[:MAX_IDENTIFIERS]
        for name in head:
            lines.append(f"- {name}")
        lines.append(f"（注）識別子が多すぎるため先頭 {MAX_IDENTIFIERS} 件のみ表示。")
        lines.append("")

    # DOM ids
    lines.append("")
    lines.append("【DOM_IDS（getElementById の文字列）】")
    if len(dom_ids_u) <= MAX_DOM:
        for x in dom_ids_u:
            lines.append(f"- {x}")
    else:
        head = dom_ids_u[:MAX_DOM]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）DOM id が多すぎるため先頭 {MAX_DOM} 件のみ表示。")

    # DOM class/name
    lines.append("")
    lines.append("【DOM_CLASSES（getElementsByClassName の文字列）】")
    if len(dom_classes_u) <= MAX_DOM:
        for x in dom_classes_u:
            lines.append(f"- {x}")
    else:
        head = dom_classes_u[:MAX_DOM]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）DOM class が多すぎるため先頭 {MAX_DOM} 件のみ表示。")

    lines.append("")
    lines.append("【DOM_NAMES（getElementsByName の文字列）】")
    if len(dom_names_u) <= MAX_DOM:
        for x in dom_names_u:
            lines.append(f"- {x}")
    else:
        head = dom_names_u[:MAX_DOM]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）DOM name が多すぎるため先頭 {MAX_DOM} 件のみ表示。")

    # selectors
    lines.append("")
    lines.append("【SELECTORS（querySelector/querySelectorAll の文字列）】")
    selectors_u = sorted(set(qs_1_u + qs_all_u))
    if len(selectors_u) <= MAX_SELECTORS:
        for x in selectors_u:
            lines.append(f"- {x}")
    else:
        head = selectors_u[:MAX_SELECTORS]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）selector が多すぎるため先頭 {MAX_SELECTORS} 件のみ表示。")

    # storage keys
    lines.append("")
    lines.append("【LOCALSTORAGE_KEYS】")
    if len(ls_keys_u) <= MAX_KEYS:
        for x in ls_keys_u:
            lines.append(f"- {x}")
    else:
        head = ls_keys_u[:MAX_KEYS]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）localStorage key が多すぎるため先頭 {MAX_KEYS} 件のみ表示。")

    lines.append("")
    lines.append("【SESSIONSTORAGE_KEYS】")
    if len(ss_keys_u) <= MAX_KEYS:
        for x in ss_keys_u:
            lines.append(f"- {x}")
    else:
        head = ss_keys_u[:MAX_KEYS]
        for x in head:
            lines.append(f"- {x}")
        lines.append(f"（注）sessionStorage key が多すぎるため先頭 {MAX_KEYS} 件のみ表示。")

    return "\n".join(lines)


def build_exec_task_block(exec_task_text: str, scope_index_block: str) -> str:
    lines: List[str] = []
    lines.append("【EXEC_TASK（このメッセージ内だけを真とする：唯一の実行指示）】")
    if exec_task_text.strip():
        lines.append(exec_task_text.strip())
    else:
        lines.append("（EXEC_TASK が空です。ユーザー指示が不足しています。）")

    lines.append("")
    # 追加した処理: 最終パートに SCOPE_INDEX を埋め込み、識別子の有無確認を先に確定できるようにする
    if scope_index_block.strip():
        lines.append(scope_index_block.rstrip())
        lines.append("")

    lines.append(EXEC_TASK_PATCH_RULES.rstrip())

    lines.append("")
    lines.append("【ChatGPT 実行ルール（強制）】")
    lines.append("・RECEIPT_CHECK: OK の場合、実行対象は上記 EXEC_TASK のみ。別の問題分析や一般論は禁止。")

    # SCOPE_CHECK を柔軟化（FAIL禁止 / 追加要求禁止 / 推測で前進）
    # 追加した処理: SCOPE_CHECK: FAIL を“仕様として不可能”にし、見つからない場合でも WARN で作業を止めずに推測で前進させる
    lines.append("・SCOPE_CHECK は原則として OK / WARN の2段階のみ（FAIL を返して停止することは禁止）。")
    lines.append("・識別子/DOM/関数が『SCOPE_INDEX に見当たらない』場合でも、ただちに停止しない。まず次を必ず実施する：")
    lines.append("  1) SCOPE_INDEX の確認（スペル違い/大文字小文字/略称を含め再確認）")
    lines.append("  2) 受領した各パート本文の範囲で全文検索（Partごとの PART_SCOPE_HINT も活用）")
    lines.append("  3) 近似一致の探索（例：大小文字差 / _-差 / 前後の接頭辞差）を試し、最も近い候補を採用する")
    lines.append("  4) EXEC_TASK は『可能な範囲で推測して前進』する（作業を止めない）")
    lines.append("・見つからない場合は SCOPE_CHECK: WARN を返し、次を必ず出力する：")
    lines.append("  - NOT_FOUND: 見つからなかった識別子/DOM/関数（名称をそのまま列挙）")
    lines.append("  - SEARCHED_IN: 検索した範囲（SCOPE_INDEX / PartID一覧 / 具体的キーワード）")
    lines.append("  - INFERRED_ACTION: 推測で行った判断（どの候補に寄せたか / どこに挿入したか）")
    lines.append("  - EXEC_CONTINUED: 続行できた作業内容（未実施があれば『未実施』として明示）")
    lines.append("  - USER_EXTRACT_REQUEST: 次の4項目を、ユーザーが『元のJS』から抽出して提示するよう要求する（この4項目のみ例外的に要求を許可）")
    lines.append("    * EXTRACT_SYMBOLS: 抽出したい関数名/識別子（カンマ区切り）")
    lines.append("    * EXTRACT_NEEDLES: 抽出したい検索語（カンマ区切り）")
    lines.append("    * PURPOSE: 抽出の目的（1行）")
    lines.append("    * DEPENDS: 依存関数/依存データの存在列挙（カンマ区切り）")
    lines.append("    （追加した処理: WARN時にユーザーへ extract 実行を誘導し、必要メタ4項目の“値”を確実に回収する）")
    lines.append("・重要：SCOPE_CHECK: WARN でも『ユーザーへ追加情報を要求する行為』は禁止。")
    lines.append("  （追加した処理: ただし EXTRACT_SYMBOLS / EXTRACT_NEEDLES / PURPOSE / DEPENDS の4項目の提示要求だけは例外として許可する）")
    lines.append("・重要：SCOPE_CHECK: WARN の場合でも、最終アウトプットは必ず提示する（停止しない）。")
    return "\n".join(lines)


def build_receipt_input_block(
    cumulative_ids: List[str],
    expected_ids: List[str],
    is_last: bool,
    exec_task_text: str,
    parts: List[SplitPart],
    scope_index_block: str,
) -> str:
    lines: List[str] = []
    lines.append("【RECEIPT_INPUT（このメッセージ内だけを真とする）】")
    lines.append(f"EXPECTED_TOTAL: {len(expected_ids)}")
    lines.append(f"RECEIVED_TOTAL: {len(cumulative_ids)}")
    lines.append("")
    lines.append("CUMULATIVE_RECEIVED_PARTIDS:")
    for pid in cumulative_ids:
        lines.append(f"- {pid}")

    if is_last:
        lines.append("")
        lines.append("EXPECTED_PARTIDS_WITH_SHA256:")
        for p in expected_ids:
            # PartID → SHA256 の対応表（受領検証用）
            part = next(x for x in parts if x.part_id == p)
            lines.append(f"- {part.part_id} | {part.part_sha256}")

    lines.append("")
    lines.append("【ChatGPTへの強制ルール】")
    lines.append("・受領確認は、このメッセージ内の CUMULATIVE_RECEIVED_PARTIDS と EXPECTED_PARTIDS のみを使用すること。")
    lines.append("・会話履歴から PartID を再収集しないこと（禁止）。")
    lines.append("・受領確認OK前に、コード内容の解釈・要約・推測・修正案提示をしないこと（禁止）。")
    lines.append("")
    lines.append("RECEIPT_REQUIRED_RESPONSE_TEMPLATE:")
    lines.append("ACK: <PartID> <PartSHA256_8> / WAITING_NEXT")

    if is_last:
        lines.append("")
        # 追加した処理: 最終パートの EXEC_TASK ブロック内に SCOPE_INDEX を埋め込む
        lines.append(build_exec_task_block(exec_task_text, scope_index_block))

    lines.append("")
    return "\n".join(lines)


def build_protocol_preamble(
    session_id: str,
    input_filename: str,
    total_parts: int,
    max_chars: int,
    max_lines: int,
    overview_text: str,
) -> str:
    lines: List[str] = []
    lines.append("【プロトコル宣言（PART_01=宣言 / LAST_PART=EXEC_TASK）】")
    lines.append(f"SessionID: {session_id}")
    lines.append(f"TargetFile: {input_filename}")
    lines.append(f"Split: total_parts={total_parts}, max_chars_per_part={max_chars}, max_lines_per_part={max_lines}")
    lines.append("")
    lines.append("【あなた（ChatGPT）への最重要ルール（厳守）】")
    lines.append("0) 分割コード受領中は、内容の解釈・要約・推測・修正案提示を一切禁止。")
    lines.append("1) 分割コード(1..N-1)受領時の返答は必ず：")
    lines.append("   ACK: <PartID> / WAITING_NEXT")
    lines.append("2) 最終分割コード(N)受領時は、末尾の RECEIPT_INPUT を用いて受領確認を実施すること。")
    lines.append("3) 受領確認は、最終メッセージ内の CUMULATIVE_RECEIVED_PARTIDS と EXPECTED_PARTIDS のみを使用（会話履歴参照は禁止）。")
    lines.append("4) 実行指示（EXEC_TASK）は『最終メッセージ内の EXEC_TASK』のみを真とする。PART_01の文は参考であり実行根拠にしない。")
    lines.append("5) RECEIPT_CHECK: OK の同一返信内で、JOIN_READY/JOIN_ACTION/EXEC_START を必ず出力し、直ちに EXEC_TASK を実行する。")
    lines.append("6) JOIN（連結）ルール（強制）:")
    lines.append("   - 分割コードを連結して“完全なJS”を作る際、パート境界に改行や空白を勝手に追加してはならない。")
    lines.append("   - 各パート本文は『提示された文字列をそのまま』連結する（パート間に暗黙の改行は存在しない）。")
    lines.append("   - したがって、分割コード同士の間に改行の明記が無い限りは『必ず連続行として読み取る』こと。")
    lines.append("   - 各パートには EndNewline: YES/NO が付く。境界が連続行かどうかはこれを唯一の根拠として判定する。")
    lines.append("")
    lines.append("【指示内容（概要：参考用／実行根拠にしない）】")
    if overview_text.strip():
        lines.append(overview_text.strip())
    else:
        # 追加した処理: 「SCOPE_CHECK: FAIL で停止」をプロトコル文言から排除する
        # 目的: ChatGPT 側が“停止”を正当化しないようにし、常に前進（OK/WARN）に寄せる
        lines.append("（未設定：実行は最終パートの EXEC_TASK に依存する。EXEC_TASK が空の場合は WARN として前進可能な範囲で続行する。）")
    lines.append("")
    lines.append("【分割コード貼り付け開始】")
    lines.append("以降は分割コード本文。上記ルールに従って受領・照合・実行せよ。")
    lines.append("")
    return "\n".join(lines)


def build_protocol_epilogue() -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("【分割終了宣言】")
    lines.append("これで分割コードは最後です。直後の RECEIPT_INPUT（このメッセージ内）を用いて受領確認を実施してください。")
    lines.append("")
    lines.append("【ChatGPTへの最終手順（強制）】")
    lines.append("1) このメッセージ内の CUMULATIVE_RECEIVED_PARTIDS を受領一覧として採用する（会話履歴参照は禁止）。")
    lines.append("2) このメッセージ内の EXPECTED_PARTIDS と照合し、欠落/重複/不一致を判定する。")
    lines.append("3) 判定結果を以下の形式で必ず返す：")
    lines.append("   RECEIPT_CHECK: OK もしくは NG")
    lines.append("   RECEIPT_MISSING: （不足があれば列挙、なければ EMPTY）")
    lines.append("   RECEIPT_DUPLICATE: （重複があれば列挙、なければ EMPTY）")
    lines.append("   RECEIPT_MISMATCH: （不一致があれば列挙、なければ EMPTY）")
    lines.append("")
    lines.append("4) 重要：RECEIPT_CHECK: OK の場合、同じ返答の中で必ず続けて次も出力し、直ちに実行する：")
    lines.append("   JOIN_READY: YES")
    lines.append("   JOIN_ACTION: P01→P02→...→Pn の順に全パートを連結して完全なJSを構築する")
    lines.append("   EXEC_START: このメッセージ内の EXEC_TASK（唯一の実行指示）を完全なJSに対して実行し、結果を提示する")
    lines.append("")
    lines.append("5) 重要：RECEIPT_CHECK: NG の場合、同じ返答の中で必ず続けて次も出力して終了する：")
    lines.append("   JOIN_READY: NO")
    lines.append("   RESEND_REQUEST: 不足/重複/不一致の PartID をそのまま列挙して再送要求する")
    lines.append("   EXEC_START: BLOCKED")
    lines.append("")
    lines.append("【禁止事項（再掲）】")
    lines.append("・受領確認OK前に、コードの要約/推測/修正提案/作業開始をしない。")
    lines.append("・RECEIPT_CHECK: OK の場合でも、上記の JOIN_READY/JOIN_ACTION/EXEC_START を同じ返答で出す前に止まらない。")
    lines.append("・実行根拠は最終メッセージ内 EXEC_TASK のみ。PART_01の文を理由に別作業を開始しない。")
    lines.append("")
    return "\n".join(lines)


def make_part_payload(
    part: SplitPart,
    language_tag: str,
    protocol_preamble: str,
    receipt_input_block: str,
    protocol_epilogue: str,
) -> str:
    # ============================================================
    # PART_SCOPE_HINT 強化（パート本文だけから抽出）
    # - TopIdentifiers: 頻出識別子TopN
    # - Defines: このパート内で定義している可能性が高い名前
    # ============================================================
    top_items = _part_top_identifiers(part.text, 12)
    top_ident_str = ", ".join([f"{name}:{cnt}" for (name, cnt) in top_items]) if top_items else ""

    defines_list = _part_defines(part.text, 40)
    defines_str = ", ".join(defines_list) if defines_list else ""

    header_lines: List[str] = []
    header_lines.append("<<<PART_BEGIN>>>")
    header_lines.append(f"【分割コード({part.index})の開始】")
    header_lines.append(f"PartID: {part.part_id}")
    header_lines.append(f"PartSHA256: {part.part_sha256}")
    header_lines.append(f"Range: chars {part.start_offset}..{part.end_offset} (len={len(part.text)})")
    header_lines.append(f"FirstLine: {part.first_line}")
    header_lines.append(f"LastLine: {part.last_line}")
    # 追加した処理: パート末尾に“実際の改行”が存在するかを明記し、JOIN時に暗黙改行を挿入させないための根拠にする
    header_lines.append(f"EndNewline: {'YES' if part.text.endswith(chr(10)) else 'NO'}")
    header_lines.append(f"PART_SCOPE_HINT: LineRange=L{part.start_line}..L{part.end_line} | BraceDepth={part.brace_depth_start}->{part.brace_depth_end}")

    # 追加した処理: パート内の探索効率を上げる（頻出識別子 / 定義名）
    header_lines.append(f"PART_SCOPE_HINT_TOP_IDENTIFIERS: {top_ident_str if top_ident_str else '(none)'}")
    header_lines.append(f"PART_SCOPE_HINT_DEFINES: {defines_str if defines_str else '(none)'}")

    header_lines.append("")

    if part.index == 1:
        header_lines.append(protocol_preamble)

    header_lines.append(f"```{language_tag}")
    header_text = "\n".join(header_lines)

    footer_lines: List[str] = []
    footer_lines.append("```")
    footer_lines.append("<<<PART_END>>>")
    footer_lines.append(receipt_input_block)

    if part.index < part.total:
        footer_lines.append(f"【分割コード({part.index})の終了】→ 次は 分割コード({part.index + 1}) を送ります")
        footer_lines.append("【ChatGPTへの指示】解釈・要約・推測・修正案提示は禁止。返答は次のみ。")
        footer_lines.append("ACK: <PartID> / WAITING_NEXT")
    else:
        footer_lines.append(f"【分割コード({part.index})の終了】→ これで最後です（全{part.total}分割）")
        footer_lines.append(protocol_epilogue)

    return header_text + "\n" + part.text + "\n" + "\n".join(footer_lines) + "\n"


def write_manifest_json(
    out_dir: Path,
    session_id: str,
    input_filename: str,
    total_parts: int,
    max_chars: int,
    max_lines: int,
    parts: List[SplitPart],
    original_sha256: str,
    instruction: str,
    original_saved_relpath: str,
    project_id: str,
    task_id: str,
    request_id: str,
) -> None:
    manifest = {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "instruction": str(instruction),
        "work": {
            "project_id": str(project_id or ""),
            "task_id": str(task_id or ""),
            "request_id": str(request_id or ""),
        },
        "input": {
            "filename": input_filename,
            "size_chars": sum(len(p.text) for p in parts),
            "sha256": original_sha256,
            "saved_copy": str(original_saved_relpath),
        },
        "split": {
            "total_parts": total_parts,
            "max_chars_per_part": max_chars,
            "max_lines_per_part": max_lines,
            "strategy": "split_on_newline_preferably_else_hard",
        },
        "parts": [
            {
                "index": p.index,
                "total": p.total,
                "part_id": p.part_id,
                "part_sha256": p.part_sha256,
                "start_offset": p.start_offset,
                "end_offset": p.end_offset,
                "len_chars": len(p.text),
                "file": f"parts/part_{p.index:02d}.txt",
            }
            for p in parts
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


from pathlib import Path

def load_html_page() -> str:
  """
  local_protocol_tool.html を同ディレクトリから読み込む。
  CWD（実行ディレクトリ）に依存しないために __file__ 基準にする。
  """
  p = Path(__file__).resolve().with_name("local_protocol_tool.html")
  return p.read_text(encoding="utf-8")

HTML_PAGE = load_html_page()


def check_js_syntax_with_node(filename: str, content: str) -> Tuple[bool, str]:
    """
    node --check を使って JS の構文チェックを行う。
    - filename の拡張子(.mjs/.cjs/.js)を維持して一時ファイル化し、Node側の解釈を合わせる。
    - Node が無い環境ではチェック不可として NG を返す（理由文字列に明示）。
    """
    name = str(filename or "input.js")
    suffix = ".js"
    lower = name.lower()
    if lower.endswith(".mjs"):
        suffix = ".mjs"
    elif lower.endswith(".cjs"):
        suffix = ".cjs"
    elif lower.endswith(".js"):
        suffix = ".js"

    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, delete=False) as tf:
            tmp_path = tf.name
            tf.write(str(content or ""))

        try:
            p = subprocess.run(
                ["node", "--check", tmp_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        if p.returncode == 0:
            return True, "OK"
        err = (p.stderr or p.stdout or "").strip()
        if not err:
            err = "node --check failed (no stderr)"
        return False, err

    except FileNotFoundError:
        return False, "node not found: Node.js が未インストールのため構文チェックできません"
    except Exception as e:
        return False, f"syntax check failed: {e}"


def now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def enforce_max_log_dirs(outroot: Path, max_keep: int) -> Tuple[int, int]:
    """
    outroot 配下の RUN ディレクトリを max_keep 個までに制限し、
    超過分は「古い順」に削除する。

    戻り値:
      (deleted_count, kept_count)
    """
    try:
        mk = int(max_keep)
    except Exception:
        mk = 0

    if mk <= 0:
        return (0, 0)

    safe_mkdir(outroot)

    dirs = [p for p in outroot.iterdir() if p.is_dir()]
    if not dirs:
        return (0, 0)

    # 新しい順（mtime降順）
    dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    keep = dirs[:mk]
    drop = dirs[mk:]

    deleted = 0
    for d in drop:
        try:
            shutil.rmtree(d)
            deleted += 1
        except Exception:
            # 削除失敗は握りつぶす（次回の実行で再トライされる）
            pass

    return (deleted, len(keep))


def generate_parts(
    filename: str,
    content: str,
    prefix: str,
    lang: str,
    maxchars: int,
    maxlines: int,
    instruction: str,
    outroot: Path,
    max_keep_logs: int,
    split_mode: str,
    iife_grace_ratio: float,
    project_id: str,
    task_id: str,
    include_rules: bool,
) -> Tuple[str, Path, List[SplitPart], List[str]]:
    session_id = make_session_id(prefix, content)

    wrapped_instruction, request_id = wrap_instruction_with_ids(
        instruction=instruction,
        session_id=session_id,
        project_id=project_id,
        task_id=task_id,
        include_rules=include_rules,
    )

    chunks = split_by_limits(
        content,
        maxchars,
        maxlines,
        split_mode=split_mode,
        iife_grace_ratio=iife_grace_ratio,
    )
    total = len(chunks)

    # PART_SCOPE_HINT 用：行番号（1-based）変換のための前処理
    line_starts = _line_start_offsets(content)

    out_dir = outroot / f"{session_id}_{now_tag()}"
    parts_dir = out_dir / "parts"
    safe_mkdir(parts_dir)

    parts: List[SplitPart] = []
    for idx, (st, ed, ch, depth_start, depth_end) in enumerate(chunks, start=1):
        part_id = build_part_id(session_id, idx, total)
        lines = ch.splitlines()
        first_line = lines[0] if lines else ""
        last_line = lines[-1] if lines else ""

        # PART_SCOPE_HINT: 行範囲（1-based）
        start_line = _offset_to_line_index(line_starts, st) + 1
        end_line = _offset_to_line_index(line_starts, max(st, ed - 1)) + 1

        parts.append(SplitPart(
            index=idx,
            total=total,
            part_id=part_id,
            text=ch,
            start_offset=st,
            end_offset=ed,

            # PART_SCOPE_HINT 用
            start_line=start_line,
            end_line=end_line,
            brace_depth_start=int(depth_start),
            brace_depth_end=int(depth_end),

            # パート本文の完全性検証用
            part_sha256=sha256_hex(ch),

            # 人間向け視認ヒント
            first_line=first_line,
            last_line=last_line,
        ))

    expected_ids = build_expected_partids(parts)
    protocol_preamble = build_protocol_preamble(
        session_id=session_id,
        input_filename=filename,
        total_parts=total,
        max_chars=maxchars,
        max_lines=maxlines,
        overview_text=wrapped_instruction,
    )
    protocol_epilogue = build_protocol_epilogue()

    # 追加した処理: 連結後JS（= 元の全文）から SCOPE_INDEX を一度だけ生成し、最終パートへ埋め込む
    scope_index_block = build_scope_index_block(content)

    payloads: List[str] = []
    for p in parts:
        cumulative_ids = build_cumulative_partids(parts, p.index)
        receipt_input = build_receipt_input_block(
            cumulative_ids=cumulative_ids,
            expected_ids=expected_ids,
            is_last=(p.index == p.total),
            exec_task_text=wrapped_instruction,
            parts=parts,
            scope_index_block=scope_index_block,
        )
        payload = make_part_payload(
            part=p,
            language_tag=lang,
            protocol_preamble=protocol_preamble,
            receipt_input_block=receipt_input,
            protocol_epilogue=protocol_epilogue,
        )
        (parts_dir / f"part_{p.index:02d}.txt").write_text(payload, encoding="utf-8")
        payloads.append(payload)

    original_basename = Path(str(filename or "input.js")).name
    original_dir = out_dir / "original"
    safe_mkdir(original_dir)

    original_saved = original_dir / original_basename
    original_saved.write_text(str(content or ""), encoding="utf-8")

    original_saved_rel = str(Path("original") / original_basename)

    write_manifest_json(
        out_dir=out_dir,
        session_id=session_id,
        input_filename=filename,
        total_parts=total,
        max_chars=maxchars,
        max_lines=maxlines,
        parts=parts,
        original_sha256=sha256_hex(content),
        instruction=wrapped_instruction,
        original_saved_relpath=original_saved_rel,
        project_id=project_id,
        task_id=task_id,
        request_id=request_id,
    )

    # outroot 配下のログ保持数を制限し、超過分を自動削除する
    enforce_max_log_dirs(outroot=outroot, max_keep=max_keep_logs)

    return session_id, out_dir, parts, payloads


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/?"):
            body = HTML_PAGE.encode("utf-8")
            self._send(200, body, "text/html; charset=utf-8")
            return

        if self.path == "/health":
            self._send(200, b"OK", "text/plain; charset=utf-8")
            return

        if self.path.startswith("/api/instructions/original"):
            from urllib.parse import urlparse, parse_qs

            outroot = Path(__file__).resolve().parent / DEFAULT_OUTROOT
            safe_mkdir(outroot)

            u = urlparse(self.path)
            qs = parse_qs(u.query or "")
            target_raw = ""
            if "output_dir" in qs and len(qs["output_dir"]) > 0:
                target_raw = str(qs["output_dir"][0] or "").strip()

            if target_raw == "":
                self._send(400, b"output_dir is empty", "text/plain; charset=utf-8")
                return

            try:
                target_path = Path(target_raw).resolve()
                outroot_real = outroot.resolve()

                if not str(target_path).startswith(str(outroot_real) + os.sep):
                    self._send(403, b"forbidden: target is outside outroot", "text/plain; charset=utf-8")
                    return

                mf = target_path / "manifest.json"
                if not mf.exists():
                    self._send(404, b"manifest.json not found", "text/plain; charset=utf-8")
                    return

                data = json.loads(mf.read_text(encoding="utf-8"))
                inp = data.get("input") or {}
                rel = str(inp.get("saved_copy") or "").strip()
                if rel == "":
                    self._send(404, b"saved_copy not found in manifest", "text/plain; charset=utf-8")
                    return

                src = (target_path / rel).resolve()

                if not str(src).startswith(str(target_path) + os.sep):
                    self._send(403, b"forbidden: invalid saved_copy path", "text/plain; charset=utf-8")
                    return

                if not src.exists():
                    self._send(404, b"original js not found", "text/plain; charset=utf-8")
                    return

                body = src.read_text(encoding="utf-8").encode("utf-8")
                self._send(200, body, "text/plain; charset=utf-8")
                return

            except Exception as e:
                self._send(500, f"failed: {e}".encode("utf-8"), "text/plain; charset=utf-8")
                return

        if self.path.startswith("/api/instructions"):
            outroot = Path(__file__).resolve().parent / DEFAULT_OUTROOT
            safe_mkdir(outroot)

            items = []
            total_dirs = 0
            try:
                dirs = [p for p in outroot.iterdir() if p.is_dir()]
                total_dirs = len(dirs)
                dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                for d in dirs[:50]:
                    mf = d / "manifest.json"
                    if not mf.exists():
                        continue
                    try:
                        data = json.loads(mf.read_text(encoding="utf-8"))
                    except Exception:
                        continue

                    inp = data.get("input") or {}
                    wk = data.get("work") or {}
                    items.append({
                        "output_dir": str(d),
                        "session_id": str(data.get("session_id") or ""),
                        "created_at": str(data.get("created_at") or ""),
                        "target_file": str(inp.get("filename") or ""),
                        "original_sha256": str(inp.get("sha256") or ""),
                        "original_saved_copy": str(inp.get("saved_copy") or ""),
                        "project_id": str(wk.get("project_id") or ""),
                        "task_id": str(wk.get("task_id") or ""),
                        "request_id": str(wk.get("request_id") or ""),
                        "instruction": str(data.get("instruction") or ""),
                    })
            except Exception as e:
                body = json.dumps({"error": str(e), "outroot": str(outroot)}, ensure_ascii=False).encode("utf-8")
                self._send(500, body, "application/json; charset=utf-8")
                return

            body = json.dumps(
                {
                    "outroot": str(outroot),
                    "total_dirs": int(total_dirs),
                    "items": items,
                },
                ensure_ascii=False
            ).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return

        self._send(404, b"Not Found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        if self.path != "/api/split" and self.path != "/api/check" and self.path != "/api/instructions/delete" and self.path != "/api/extract":
            self._send(404, b"Not Found", "text/plain; charset=utf-8")
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self._send(400, b"Missing body", "text/plain; charset=utf-8")
            return

        raw = self.rfile.read(length)
        try:
            req = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send(400, f"Invalid JSON: {e}".encode("utf-8"), "text/plain; charset=utf-8")
            return

        if self.path == "/api/instructions/delete":
            outroot = Path(__file__).resolve().parent / DEFAULT_OUTROOT
            safe_mkdir(outroot)

            target_raw = str(req.get("output_dir") or "").strip()
            if target_raw == "":
                self._send(400, b"output_dir is empty", "text/plain; charset=utf-8")
                return

            try:
                target_path = Path(target_raw).resolve()
                outroot_real = outroot.resolve()

                # outroot 配下だけ削除を許可（安全）
                if not str(target_path).startswith(str(outroot_real) + os.sep):
                    self._send(403, b"forbidden: target is outside outroot", "text/plain; charset=utf-8")
                    return

                # outroot 自体を消すのは禁止
                if target_path == outroot_real:
                    self._send(403, b"forbidden: cannot delete outroot", "text/plain; charset=utf-8")
                    return

                if not target_path.exists():
                    body = json.dumps({"ok": True, "deleted": False, "reason": "not found"}, ensure_ascii=False).encode("utf-8")
                    self._send(200, body, "application/json; charset=utf-8")
                    return

                if not target_path.is_dir():
                    self._send(400, b"output_dir is not a directory", "text/plain; charset=utf-8")
                    return

                shutil.rmtree(target_path)

                body = json.dumps({"ok": True, "deleted": True}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8")
                self._send(500, body, "application/json; charset=utf-8")
                return

        filename = str(req.get("filename") or "input.js")
        content = str(req.get("content") or "")

        if self.path == "/api/check":
            if content == "":
                body = json.dumps({"ok": False, "error": "content is empty"}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            ok, msg = check_js_syntax_with_node(filename=filename, content=content)
            body = json.dumps({"ok": bool(ok), "error": "" if ok else str(msg)}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return

        if self.path == "/api/extract":
            # 抽出は「ファイル全文」から行う（splitとは別）
            if content == "":
                body = json.dumps({"ok": False, "error": "content is empty"}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            symbols_raw = req.get("symbols")
            needles_raw = req.get("needles")

            symbols = []
            needles = []

            if isinstance(symbols_raw, list):
                symbols = [str(x).strip() for x in symbols_raw if str(x).strip() != ""]
            elif isinstance(symbols_raw, str):
                symbols = [x.strip() for x in symbols_raw.split(",") if x.strip() != ""]

            if isinstance(needles_raw, list):
                needles = [str(x) for x in needles_raw if str(x) != ""]
            elif isinstance(needles_raw, str):
                needles = [x for x in needles_raw.split(",") if x != ""]

            try:
                ctx_lines = int(req.get("context_lines") if req.get("context_lines") is not None else DEFAULT_EXTRACT_CONTEXT_LINES)
            except Exception:
                ctx_lines = DEFAULT_EXTRACT_CONTEXT_LINES
            if ctx_lines < 0:
                ctx_lines = 0

            try:
                max_matches = int(req.get("max_matches") if req.get("max_matches") is not None else DEFAULT_EXTRACT_MAX_MATCHES)
            except Exception:
                max_matches = DEFAULT_EXTRACT_MAX_MATCHES
            if max_matches <= 0:
                max_matches = DEFAULT_EXTRACT_MAX_MATCHES

            blocks = []

            # 1) 関数まるごと抽出
            for name in symbols:
                found, header, body = extract_function_whole(js_text=content, name=name)
                blocks.append({
                    "kind": "function_whole",
                    "name": name,
                    "found": bool(found),
                    "header": str(header),
                    "text": str(body),
                    "sha256": sha256_hex(str(body)) if found else "",
                })

            # 2) 呼び出し周辺抽出
            for nd in needles:
                hit_count, ctx_blocks = extract_context_around(
                    js_text=content,
                    needle=nd,
                    context_lines=ctx_lines,
                    max_matches=max_matches,
                )
                blocks.append({
                    "kind": "context",
                    "needle": nd,
                    "hit_count": int(hit_count),
                    "context_lines": int(ctx_lines),
                    "max_matches": int(max_matches),
                    "items": [
                        {
                            "header": str(h),
                            "text": str(t),
                            "sha256": sha256_hex(str(t)),
                        }
                        for (h, t) in ctx_blocks
                    ],
                })

            resp = {
                "ok": True,
                "filename": filename,
                "symbols": symbols,
                "needles": needles,
                "context_lines": int(ctx_lines),
                "max_matches": int(max_matches),
                "blocks": blocks,
            }

            body = json.dumps(resp, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return

        prefix = str(req.get("prefix") or DEFAULT_PREFIX)
        lang = str(req.get("lang") or DEFAULT_LANG)

        try:
            maxchars = int(req.get("maxchars") or DEFAULT_MAXCHARS)
            maxlines = int(req.get("maxlines") or DEFAULT_MAXLINES)
            maxlogs = int(req.get("maxlogs") or DEFAULT_MAX_LOG_DIRS)
        except Exception:
            self._send(400, b"maxchars/maxlines/maxlogs must be integers", "text/plain; charset=utf-8")
            return

        split_mode = str(req.get("split_mode") or DEFAULT_SPLIT_MODE).strip().upper()
        if split_mode not in ("A", "B", "C"):
            split_mode = DEFAULT_SPLIT_MODE

        try:
            iife_grace_ratio = float(req.get("iife_grace_ratio") if req.get("iife_grace_ratio") is not None else DEFAULT_IIFE_GRACE_RATIO)
        except Exception:
            iife_grace_ratio = DEFAULT_IIFE_GRACE_RATIO

        instruction = str(req.get("instruction") or "")

        project_id = str(req.get("project_id") or "").strip()
        task_id = str(req.get("task_id") or "").strip()

        include_rules_raw = req.get("include_rules")
        include_rules = bool(include_rules_raw) if include_rules_raw is not None else False

        if content == "":
            self._send(400, b"content is empty", "text/plain; charset=utf-8")
            return

        if instruction.strip() == "":
            # 生成時に instruction が空なら拒否する（空EXEC_TASK防止）
            self._send(400, b"instruction is empty", "text/plain; charset=utf-8")
            return

        outroot = Path(__file__).resolve().parent / DEFAULT_OUTROOT
        safe_mkdir(outroot)

        try:
            session_id, out_dir, parts, payloads = generate_parts(
                filename=filename,
                content=content,
                prefix=prefix,
                lang=lang,
                maxchars=maxchars,
                maxlines=maxlines,
                instruction=instruction,
                outroot=outroot,
                max_keep_logs=maxlogs,
                split_mode=split_mode,
                iife_grace_ratio=iife_grace_ratio,
                project_id=project_id,
                task_id=task_id,
                include_rules=include_rules,
            )
        except Exception as e:
            self._send(500, f"Split failed: {e}".encode("utf-8"), "text/plain; charset=utf-8")
            return

        resp = {
            "session_id": session_id,
            "output_dir": str(out_dir),
            "parts": [
                {
                    "index": p.index,
                    "total": p.total,
                    "part_id": p.part_id,

                    # UI表示用: パート本文SHA256（貼り間違い検出）
                    "part_sha256": p.part_sha256,

                    # UI表示用: SHA8（人間が一瞬で照合できる短縮）
                    "part_sha8": p.part_sha256[:8].upper(),

                    "start_offset": p.start_offset,
                    "end_offset": p.end_offset,
                    "len_chars": len(p.text),
                    "payload": payloads[p.index - 1],
                }
                for p in parts
            ],
        }

        body = json.dumps(resp, ensure_ascii=False).encode("utf-8")
        self._send(200, body, "application/json; charset=utf-8")


def main() -> None:
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    print("OK")
    print(f"Local Tool URL: http://{BIND_HOST}:{BIND_PORT}/")
    print(f"Output root: {Path(__file__).resolve().parent / DEFAULT_OUTROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
