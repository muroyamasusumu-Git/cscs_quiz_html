#!/usr/bin/env python3
# local_protocol_tool.py
# -*- coding: utf-8 -*-
#
# ============================================================
# ★ IMPORTANT: このスクリプトは単体では成立しない（3ファイル密結合）
# ------------------------------------------------------------
# local_protocol_tool.html / local_protocol_tool.js / local_protocol_tool.py は
# 「1つのローカル補助ツール」として設計された不可分セットである。
#
# ChatGPT や人間が本ファイルだけを読んで
# 「CLIツール」「単独HTTPサーバ」「Pythonユーティリティ」
# と誤解しないよう、役割と契約をここに明示する。
#
# 【役割分担】
#   1) local_protocol_tool.html
#      - UI と DOM 構造のみを定義
#      - input / textarea / button / list 等の id を提供
#      - JS は DOM id に強く依存（id変更＝即破壊）
#
#   2) local_protocol_tool.js
#      - UIロジック担当（fetch / copy / history / mode）
#      - /api/split /api/extract /api/check /api/instructions* を呼び出す
#      - 表示・コピー・履歴・UI状態管理を担う
#
#   3) local_protocol_tool.py（このファイル）
#      - ローカルHTTPサーバ（127.0.0.1）
#      - HTML配信（"/"）および API 実装を担当
#      - split / extract / check の中核ロジックと
#        出力プロトコル（<<<PART_BEGIN>>> 等）を生成
#
# 【重要な設計契約（変更時は3ファイル同時確認）】
#   - HTMLのDOM id変更 → JSが壊れる
#   - APIの入出力形式変更 → JS/UIが壊れる
#   - 出力プロトコル変更 → ユーザーの貼り付け運用が壊れる
#
# → 修正時は必ず html / js / py を「同時に」確認・更新すること
# ============================================================

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
    # ★ 追加した処理: 複数ファイルを「1セッション」に束ねるためのメタ
    source_filename: str
    file_tag: str

    # ★ 追加した処理: “全体の何番目”か（全ファイル通しの連番）
    global_index: int
    global_total: int

    # 互換のため残す（ただし multi では global_index/global_total を正として扱う）
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
    
def make_session_id_multi(prefix: str, targets: List[dict]) -> str:
    """
    ★ 追加した処理: 複数JSを「1セッション」に束ねる共通 SessionID を作る。
    - ファイル順序も含めて固定化（順序が変わると別IDになる）
    - instruction には依存させない（“同じJS束”なら同じSessionIDにしたい想定）
    """
    lines: List[str] = []
    for t in targets:
        fn = str(t.get("filename") or "")
        ct = str(t.get("content") or "")
        lines.append("===FILE_BEGIN===")
        lines.append(fn)
        lines.append(str(len(ct)))
        lines.append(ct)
        lines.append("===FILE_END===")
    base = "\n".join(lines)
    digest8 = sha256_hex(base)[:8].upper()
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


def build_part_id(session_id: str, global_idx: int, global_total: int) -> str:
    # ★ 追加した処理: 複数ファイルでも PartID が衝突しないよう “全体連番” を正とする
    return f"{session_id}-P{global_idx:02d}-of-{global_total:02d}"


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


def extract_python_block_whole(py_text: str, name: str) -> Tuple[bool, str, str]:
    """
    Python の def / async def / class を “まるごと” 抽出（簡易・インデント依存）。
    - def NAME(...):
    - async def NAME(...):
    - class NAME(...):
    戻り値: (found, header, body)
    """
    s = str(py_text or "")
    target = str(name or "").strip()
    if target == "":
        return (False, "name is empty", "")

    import re

    lines = s.splitlines(True)
    if not lines:
        return (False, "empty", "")

    rg = re.compile(r"^([ \t]*)(async\s+def|def|class)\s+" + re.escape(target) + r"\b", re.ASCII)

    start_line_idx = -1
    base_indent = ""
    kind = ""

    for i, ln in enumerate(lines):
        m = rg.match(ln)
        if m:
            start_line_idx = i
            base_indent = str(m.group(1) or "")
            kind = str(m.group(2) or "")
            break

    if start_line_idx == -1:
        return (False, "not found", "")

    def _indent_len(x: str) -> int:
        n = 0
        for ch in x:
            if ch == " ":
                n += 1
            elif ch == "\t":
                n += 4
            else:
                break
        return n

    base_len = _indent_len(base_indent)

    end_line_idx = len(lines)
    for j in range(start_line_idx + 1, len(lines)):
        ln = lines[j]
        if ln.strip() == "":
            continue
        cur_indent = re.match(r"^([ \t]*)", ln).group(1)
        cur_len = _indent_len(cur_indent)

        if cur_len <= base_len:
            end_line_idx = j
            break

    body = "".join(lines[start_line_idx:end_line_idx])

    start_off = sum(len(x) for x in lines[:start_line_idx])
    end_off = start_off + len(body)

    header = f"EXTRACT_PY_BLOCK: {kind} {target} (chars {start_off}..{end_off})"
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
    # ★ 修正: 複数ファイル対応では “全体連番(global_index)” が正
    return [p.part_id for p in parts if p.global_index <= upto_index_inclusive]


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

def split_scope_extract_code_into_blocks(scope_extract_code: str) -> List[str]:
    """
    SCOPE_CHECK 抽出コードを「ブロック単位」で分割する。

    ブロック定義（ユーザー仕様）:
      HEADER:
      SHA256:
      ```javascript
      ...
      ```

    ルール:
      - ブロック内部（```javascript ... ```）では絶対に分割しない
      - ブロックの境界（次の HEADER: が始まる位置）でのみ分割する
      - ブロックが検出できない場合は [] を返す（呼び出し側で互換フォールバック）
    """
    s = str(scope_extract_code or "")
    if s.strip() == "":
        return []

    lines = s.splitlines(True)  # 改行保持
    n = len(lines)
    if n <= 0:
        return []

    starts: List[int] = []
    for i, ln in enumerate(lines):
        if ln.startswith("HEADER:"):
            starts.append(i)

    if not starts:
        return []

    blocks: List[str] = []
    for idx, st in enumerate(starts):
        ed = starts[idx + 1] if idx + 1 < len(starts) else n
        chunk = "".join(lines[st:ed]).strip()
        if chunk == "":
            continue

        # 最低限の形（SHA256 と ```javascript を含む）を満たすものだけ“ブロック”として採用する
        # ※厳密パースにしない（ユーザーの入力ゆらぎ耐性）
        if "SHA256:" in chunk and ("```javascript" in chunk or "```python" in chunk) and "```" in chunk:
            blocks.append(chunk)
        else:
            # 形が崩れている HEADER: 断片は、全体を壊さないためブロック扱いしない
            # （呼び出し側は blocks==[] の場合に従来フォールバックする）
            return []

    return blocks

def build_exec_task_block(exec_task_text: str, scope_index_block: str) -> str:
    lines: List[str] = []
    lines.append("【EXEC_TASK（このメッセージ内だけを真とする：唯一の実行指示）】")
    # 追加した処理: 参照元の根拠を明文化し、「どのファイルのコードか」を SourceFile ヘッダで一意に確定させる安全装置
    lines.append("REFERENCE_SOURCE: 各 <<<PART_BEGIN>>> ヘッダの SourceFile を参照元の唯一の根拠として扱うこと（推測で他ファイル由来にしない）")
    if exec_task_text.strip():
        lines.append(exec_task_text.strip())
    else:
        lines.append("（EXEC_TASK が空です。ユーザー指示が不足しています。）")

    lines.append("")
    # 追加した処理: 最終パートには EXEC_TASK を小さく保つため、SCOPE_INDEX のみを埋め込む（抽出コードは別パートへ移動）
    if scope_index_block.strip():
        lines.append(scope_index_block.rstrip())
        lines.append("")

    lines.append(EXEC_TASK_PATCH_RULES.rstrip())

    lines.append("")
    lines.append("【ChatGPT 実行ルール（強制）】")
    lines.append("・RECEIPT_CHECK: OK の場合、実行対象は上記 EXEC_TASK のみ。別の問題分析や一般論は禁止。")
    lines.append("・重要：指示に対してプロトコル内の『禁止項目』により実行不可となった処理がある場合は、その事実を必ず簡潔に明記すること。")
    lines.append("  - 出力形式（1行固定）: BLOCKED_BY_PROTOCOL: <実行不可になった処理> | <該当した禁止項目>")

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
    scope_extract_code: str,
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
    # 追加した処理: 受領確認・実行フェーズを問わず、同一 SessionID の過去 PART 本文は常に参照可能とする
    lines.append("・受領確認および実行フェーズでは、同一 SessionID に属する過去PART本文を必ず全て参照すること。")
    # 追加した処理: SessionID が異なる PART の混入のみを禁止対象とする
    lines.append("・参照対象は、同一 SessionID の EXPECTED_PARTIDS に含まれる PART に限定すること。")
    # 追加した処理: 受領確認完了前は作業開始のみ禁止し、参照自体は禁止しない
    lines.append("・受領確認OK前は、作業開始（JOIN/EXEC）を行わないこと。")
    lines.append("")
    lines.append("RECEIPT_REQUIRED_RESPONSE_TEMPLATE:")
    lines.append("ACK: <PartID> <PartSHA256_8> / WAITING_NEXT")

    if is_last:
        lines.append("")
        # 追加した処理: 最終パートの EXEC_TASK ブロック内に SCOPE_INDEX を埋め込む
        # 追加した処理: さらに SCOPE_CHECK 用の抽出コード（ユーザー入力）を「最終パートにだけ」固定挿入する
        # 追加した処理: 最終パートは EXEC_TASK のみに寄せる（抽出コードは別パートへ移動）
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
    # 追加した処理: PART1 は「前文専用パート（PROTOCOL_PREAMBLE）」であり、コード本文は PART2 から始まることを明文化する
    lines.append("【プロトコル宣言（PART_01=PROTOCOL_PREAMBLE / PART_02..=CODE / LAST_PART=EXEC_TASK）】")
    lines.append(f"SessionID: {session_id}")
    lines.append(f"TargetFile: {input_filename}")
    lines.append(f"Split: total_parts={total_parts}, max_chars_per_part={max_chars}, max_lines_per_part={max_lines}")
    lines.append("")
    lines.append("【あなた（ChatGPT）への最重要ルール（厳守）】")
    lines.append("0) 分割コード受領中は、内容の解釈・要約・推測・修正案提示を一切禁止。")
    lines.append("1) 分割コード(1..N-1)受領時の返答は必ず：")
    lines.append("   ACK: <PartID> / WAITING_NEXT")
    lines.append("2) 最終分割コード(N)受領時は、末尾の RECEIPT_INPUT を用いて受領確認を実施すること。")
    # 追加した処理: 同一 SessionID の過去 PART は、受領確認・実行フェーズを問わず常に参照可能とする
    lines.append("3) 同一 SessionID に属する EXPECTED_PARTIDS の過去PART本文は、常に参照対象とする。")
    # 追加した処理: SessionID 境界のみを唯一の安全境界とする
    lines.append("3.5) 異なる SessionID の PART を参照することは禁止する。")
    # 追加した処理: 実行根拠の除外対象を「PART_01（前文専用）」として明確化する
    lines.append("4) 実行指示（EXEC_TASK）は『最終メッセージ内の EXEC_TASK』のみを真とする。PART_01（PROTOCOL_PREAMBLE）は参考であり実行根拠にしない。")
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
    # ★ 修正: 表示上の「分割コード(n)」は multi でも一致するよう “全体連番(global_index)” を使う
    header_lines.append(f"【分割コード({part.global_index})の開始】")
    header_lines.append(f"PartID: {part.part_id}")
    # 追加した処理: 各パートが「どの入力ファイル由来か」をヘッダに明示し、貼り付け後も由来を一目で追えるようにする
    header_lines.append(f"SourceFile: {part.source_filename}")
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

    # 追加した処理: protocol_preamble は「前文専用パート（PROTOCOL_PREAMBLE）」として独立出力するため、
    #               コード本文パートへ混在させない（Part1本文未受領扱い事故の主因を除去）

    header_lines.append(f"```{language_tag}")
    header_text = "\n".join(header_lines)

    footer_lines: List[str] = []
    footer_lines.append("```")
    footer_lines.append("<<<PART_END>>>")
    footer_lines.append(receipt_input_block)

    if part.global_index < part.global_total:
        footer_lines.append(f"【分割コード({part.global_index})の終了】→ 次は 分割コード({part.global_index + 1}) を送ります（全{part.global_total}分割）")
        footer_lines.append("【ChatGPTへの指示】解釈・要約・推測・修正案提示は禁止。返答は次のみ。")
        footer_lines.append("ACK: <PartID> / WAITING_NEXT")
    else:
        footer_lines.append(f"【分割コード({part.global_index})の終了】→ これで最後です（全{part.global_total}分割）")
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
                # ★ 修正: manifest も “全体連番(global_index/global_total)” を正として記録する
                "index": p.global_index,
                "total": p.global_total,
                "part_id": p.part_id,
                "part_sha256": p.part_sha256,
                "start_offset": p.start_offset,
                "end_offset": p.end_offset,
                "len_chars": len(p.text),
                "file": f"parts/part_{p.global_index:02d}.txt",
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


def check_py_syntax_with_py_compile(filename: str, content: str) -> Tuple[bool, str]:
    """
    python -m py_compile を使って Python の構文チェックを行う。
    - 一時ファイルとして .py を保存して py_compile を実行する。
    - Python が無い環境ではチェック不可として NG を返す（理由文字列に明示）。
    """
    name = str(filename or "input.py")
    suffix = ".py"
    lower = name.lower()
    if lower.endswith(".py"):
        suffix = ".py"

    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, delete=False) as tf:
            tmp_path = tf.name
            tf.write(str(content or ""))

        try:
            p = subprocess.run(
                ["python3", "-m", "py_compile", tmp_path],
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
            err = "py_compile failed (no stderr)"
        return False, err

    except FileNotFoundError:
        return False, "python3 not found: Python が未インストールのため構文チェックできません"
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
    split_targets: List[dict],
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
    scope_extract_code: str,
) -> Tuple[str, Path, List[SplitPart], List[str]]:
    # ★ 追加した処理: 複数ファイルを「1セッション」に束ねる
    session_id = make_session_id_multi(prefix, split_targets)

    wrapped_instruction, request_id = wrap_instruction_with_ids(
        instruction=instruction,
        session_id=session_id,
        project_id=project_id,
        task_id=task_id,
        include_rules=include_rules,
    )

    out_dir = outroot / f"{session_id}_{now_tag()}"
    parts_dir = out_dir / "parts"
    safe_mkdir(parts_dir)

    # ------------------------------------------------------------
    # 1) まず全ファイルを分割して “全体パート数” を確定
    # ------------------------------------------------------------
    per_file_chunks: List[dict] = []
    global_total = 0

    for file_idx, tgt in enumerate(split_targets, start=1):
        t_filename = str(tgt.get("filename") or "input.js")
        t_content = str(tgt.get("content") or "")
        if t_content == "":
            continue

        chunks = split_by_limits(
            t_content,
            maxchars,
            maxlines,
            split_mode=split_mode,
            iife_grace_ratio=iife_grace_ratio,
        )

        file_tag = f"F{file_idx:02d}"
        per_file_chunks.append({
            "file_idx": int(file_idx),
            "file_tag": file_tag,
            "filename": t_filename,
            "content": t_content,
            "chunks": chunks,
        })
        global_total += int(len(chunks))

    if global_total <= 0:
        raise ValueError("no valid input files (all contents were empty?)")

    # ------------------------------------------------------------
    # 2) SCOPE_INDEX は「全ファイル結合テキスト」から1回だけ作る
    # ------------------------------------------------------------
    concat_lines: List[str] = []
    for it in per_file_chunks:
        concat_lines.append("/* ===CSCS_MULTI_FILE_BEGIN=== */")
        concat_lines.append(f"/* FILE: {str(it.get('filename') or '')} */")
        concat_lines.append(str(it.get("content") or ""))
        concat_lines.append("/* ===CSCS_MULTI_FILE_END=== */")
    concat_text = "\n".join(concat_lines)
    scope_index_block = build_scope_index_block(concat_text)

    # ------------------------------------------------------------
    # 3) SplitPart を “全体連番” で作る
    # ------------------------------------------------------------
    parts: List[SplitPart] = []
    global_idx = 0

    for it in per_file_chunks:
        t_filename = str(it.get("filename") or "input.js")
        t_content = str(it.get("content") or "")
        file_tag = str(it.get("file_tag") or "")
        chunks = it.get("chunks") or []

        # PART_SCOPE_HINT 用：行番号（1-based）
        line_starts = _line_start_offsets(t_content)

        file_total = int(len(chunks))
        for local_idx, (st, ed, ch, depth_start, depth_end) in enumerate(chunks, start=1):
            global_idx += 1
            part_id = build_part_id(session_id, global_idx, global_total)

            lines = ch.splitlines()
            first_line = lines[0] if lines else ""
            last_line = lines[-1] if lines else ""

            start_line = _offset_to_line_index(line_starts, st) + 1
            end_line = _offset_to_line_index(line_starts, max(st, ed - 1)) + 1

            parts.append(SplitPart(
                source_filename=t_filename,
                file_tag=file_tag,
                global_index=int(global_idx),
                global_total=int(global_total),

                index=int(local_idx),
                total=int(file_total),

                part_id=part_id,
                text=ch,
                start_offset=st,
                end_offset=ed,

                start_line=start_line,
                end_line=end_line,
                brace_depth_start=int(depth_start),
                brace_depth_end=int(depth_end),

                part_sha256=sha256_hex(ch),

                first_line=first_line,
                last_line=last_line,
            ))

    expected_ids = build_expected_partids(parts)

    # ------------------------------------------------------------
    # 4) プロトコル文言（前文）は「最終パート列が確定した後」に生成する
    # ------------------------------------------------------------
    # 追加した処理:
    # - protocol_preamble は Part1（前文専用パート）にのみ出す
    # - total_parts は「最終確定後の総数」を使う（ズレ根絶）
    file_list_lines: List[str] = []
    file_list_lines.append("【MULTI_FILE_TARGETS（順序固定）】")
    for it in per_file_chunks:
        file_list_lines.append(f"- {str(it.get('file_tag') or '')}: {str(it.get('filename') or '')}")

    overview_text = wrapped_instruction.rstrip() + "\n\n" + "\n".join(file_list_lines) + "\n"

    protocol_preamble = ""
    protocol_epilogue = build_protocol_epilogue()

    # ------------------------------------------------------------
    # 4.5) SCOPE_CHECK 抽出コードを「追加パート」としてぶら下げる（最終パート固定挿入を廃止）
    # ------------------------------------------------------------
    # 追加した処理:
    # - 抽出コードは「ブロック単位（HEADER/SHA256/```javascript ... ```）」で扱う
    # - ブロック内部（コードフェンス内）では分割しない
    # - maxlines 上限で“詰めて”複数の追加パートにする（最終パート肥大化を防ぐ）
    # - 最後のパートは EXEC_TASK 専用（小さく保つ）
    extract_parts_texts: List[str] = []

    if str(scope_extract_code or "").strip():
        blocks = split_scope_extract_code_into_blocks(str(scope_extract_code))

        if blocks:
            cur_lines = 0
            cur_buf: List[str] = []

            for i, b in enumerate(blocks, start=1):
                block_text = ""
                block_text += "【SCOPE_CHECK_EXTRACT_CODE（追加パート：ブロック単位／ブロック内部は分割しない）】\n"
                block_text += f"【SCOPE_CHECK_EXTRACT_BLOCK: {i}/{len(blocks)}】\n"
                block_text += b.rstrip() + "\n"

                block_line_count = block_text.count("\n")

                # 追加した処理: 1200行上限で“パート詰め”する（ブロック単位でのみ移動）
                if cur_buf and (cur_lines + block_line_count) > int(maxlines):
                    extract_parts_texts.append("\n".join(cur_buf).rstrip() + "\n")
                    cur_buf = []
                    cur_lines = 0

                cur_buf.append(block_text.rstrip())
                cur_lines += block_line_count

            if cur_buf:
                extract_parts_texts.append("\n".join(cur_buf).rstrip() + "\n")

        else:
            # 追加した処理: ブロック検出できない場合は、従来互換として“丸ごと1追加パート”にする（最終パートには入れない）
            extract_parts_texts.append(
                "【SCOPE_CHECK_EXTRACT_CODE（追加パート：ブロック区切り検出不能のため丸ごと）】\n"
                "```javascript\n"
                + str(scope_extract_code).rstrip()
                + "\n```\n"
            )

    # ------------------------------------------------------------
    # 5) EXEC_TASK 専用の「最終パート」を追加する（本文コードは空）
    # ------------------------------------------------------------
    exec_part = SplitPart(
        source_filename="EXEC_TASK",
        file_tag="EXEC_TASK",
        global_index=0,
        global_total=0,
        index=0,
        total=0,
        part_id="",
        text="",
        start_offset=0,
        end_offset=0,
        start_line=0,
        end_line=0,
        brace_depth_start=0,
        brace_depth_end=0,
        part_sha256=sha256_hex(""),
        first_line="",
        last_line="",
    )

    # ------------------------------------------------------------
    # 6) parts を再構成（JSパート → 抽出追加パート → EXEC_TASK最終パート）
    # ------------------------------------------------------------
    rebuilt_parts: List[SplitPart] = []

    for p in parts:
        rebuilt_parts.append(p)

    for idx, t in enumerate(extract_parts_texts, start=1):
        rebuilt_parts.append(SplitPart(
            source_filename="SCOPE_CHECK_EXTRACT_CODE",
            file_tag="SCOPE_EXTRACT",
            global_index=0,
            global_total=0,
            index=0,
            total=0,
            part_id="",
            text=str(t or ""),
            start_offset=0,
            end_offset=0,
            start_line=0,
            end_line=0,
            brace_depth_start=0,
            brace_depth_end=0,
            part_sha256=sha256_hex(str(t or "")),
            first_line=str(t or "").splitlines()[0] if str(t or "").splitlines() else "",
            last_line=str(t or "").splitlines()[-1] if str(t or "").splitlines() else "",
        ))

    rebuilt_parts.append(exec_part)

    # ------------------------------------------------------------
    # 6.5) PROTOCOL_PREAMBLE（前文専用パート）を先頭に挿入する
    # ------------------------------------------------------------
    # 追加した処理:
    # - Part1 に「長い前文 + コード」が混在する事故を構造的に排除する
    # - total_parts は「前文パート込みの最終総数」で確定させる
    final_total_with_preamble = int(len(rebuilt_parts) + 1)

    protocol_preamble = build_protocol_preamble(
        session_id=session_id,
        input_filename="MULTI_FILES",
        total_parts=final_total_with_preamble,
        max_chars=maxchars,
        max_lines=maxlines,
        overview_text=overview_text,
    )

    preamble_part = SplitPart(
        source_filename="PROTOCOL_PREAMBLE",
        file_tag="PROTOCOL_PREAMBLE",
        global_index=0,
        global_total=0,
        index=0,
        total=0,
        part_id="",
        text=str(protocol_preamble or ""),
        start_offset=0,
        end_offset=0,
        start_line=0,
        end_line=0,
        brace_depth_start=0,
        brace_depth_end=0,
        part_sha256=sha256_hex(str(protocol_preamble or "")),
        first_line=str(protocol_preamble or "").splitlines()[0] if str(protocol_preamble or "").splitlines() else "",
        last_line=str(protocol_preamble or "").splitlines()[-1] if str(protocol_preamble or "").splitlines() else "",
    )

    # 追加した処理: PROTOCOL_PREAMBLE を必ず先頭に置く（PART_01 専用）
    # - JS本文はこの直後（PART_02 以降）から始まる構造に固定する
    parts = [preamble_part] + rebuilt_parts

    # ★ 修正1（最重要）:
    # 最終parts確定後に、全パートの PartID を必ず振り直す（payload生成より前）
    # - parts を再構成（前文/抽出/EXEC_TASK を含む）した結果に合わせて
    #   global_index / global_total / part_id を“最終列”で再確定する
    global_total_new = int(len(parts))
    for gi, p in enumerate(parts, start=1):
        # 追加した処理: “全体の何番目か”を最終列に合わせて更新する
        p.global_index = int(gi)

        # 追加した処理: “最終総数”を全パートに反映する
        p.global_total = int(global_total_new)

        # 追加した処理: PartID を最終列に合わせて必ず再発番する（旧PartIDの残留を防ぐ）
        p.part_id = build_part_id(session_id, int(gi), int(global_total_new))

    # 追加した処理: 受領照合用の expected_ids も、再発番後の PartID 群で作り直す
    expected_ids = build_expected_partids(parts)

    payloads: List[str] = []
    for p in parts:
        # ★ 追加した処理: 受領確認は “全体連番” を使う
        cumulative_ids = build_cumulative_partids(parts, p.global_index)

        # ★ 追加した処理: EXEC_TASK を載せるのは “全体の最終パートだけ”（最終パートは EXEC_TASK 専用）
        is_last_overall = (p.global_index == p.global_total)

        # 追加した処理: 抽出追加パートは本文が “text” なので language_tag を切り替える
        lang_tag = lang
        # 追加した処理: PROTOCOL_PREAMBLE / 抽出追加パート / EXEC_TASK はコード本文ではないため text 扱いにする
        if str(p.source_filename) in ("PROTOCOL_PREAMBLE", "SCOPE_CHECK_EXTRACT_CODE", "EXEC_TASK"):
            lang_tag = "text"

        receipt_input = build_receipt_input_block(
            cumulative_ids=cumulative_ids,
            expected_ids=expected_ids,
            is_last=bool(is_last_overall),
            exec_task_text=wrapped_instruction if is_last_overall else "",
            parts=parts,
            scope_index_block=scope_index_block if is_last_overall else "",
            scope_extract_code="",
        )

        # 追加した処理: protocol_preamble は前文専用パートの本文として出すため、
        #               make_part_payload() 側へ混在させない（常に空を渡す）
        payload = make_part_payload(
            part=p,
            language_tag=lang_tag,
            protocol_preamble="",
            receipt_input_block=receipt_input,
            protocol_epilogue=protocol_epilogue,
        )

        (parts_dir / f"part_{p.global_index:02d}.txt").write_text(payload, encoding="utf-8")
        payloads.append(payload)

    # ------------------------------------------------------------
    # 5) manifest は “MULTI_FILES” として残し、original は全ファイル保存する
    # ------------------------------------------------------------
    original_dir = out_dir / "original"
    safe_mkdir(original_dir)

    for it in per_file_chunks:
        fn = Path(str(it.get("filename") or "input.js")).name
        (original_dir / fn).write_text(str(it.get("content") or ""), encoding="utf-8")

    # manifest は最小限の互換情報として “先頭ファイル” を代表に入れる
    rep_filename = str(per_file_chunks[0].get("filename") or "MULTI_FILES")
    rep_sha256 = sha256_hex(str(per_file_chunks[0].get("content") or ""))

    write_manifest_json(
        out_dir=out_dir,
        session_id=session_id,
        input_filename=rep_filename,
        # ★ 修正2:
        # manifest.json の total_parts は “最終総数(len(parts))” に必ず合わせる
        # - 前文パート / 抽出追加パート / EXEC_TASK最終パート を含む最終列の総数を記録する
        total_parts=int(len(parts)),
        max_chars=maxchars,
        max_lines=maxlines,
        parts=parts,
        original_sha256=rep_sha256,
        instruction=wrapped_instruction,
        original_saved_relpath="original/",
        project_id=project_id,
        task_id=task_id,
        request_id=request_id,
    )

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

        # ------------------------------------------------------------
        # ★ 静的ファイル配信（同ディレクトリ限定）
        # - local_protocol_tool.html から参照される local_protocol_tool.js を返す
        # - __file__ と同階層のファイルのみ許可（ディレクトリトラバーサル防止）
        # ------------------------------------------------------------
        if self.path == "/local_protocol_tool.js":
            try:
                p = Path(__file__).resolve().with_name("local_protocol_tool.js")
                body = p.read_bytes()
                self._send(200, body, "application/javascript; charset=utf-8")
                return
            except FileNotFoundError:
                self._send(404, b"local_protocol_tool.js not found", "text/plain; charset=utf-8")
                return
            except Exception as e:
                self._send(500, f"failed to read local_protocol_tool.js: {e}".encode("utf-8"), "text/plain; charset=utf-8")
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

                # saved_copy がディレクトリ（例: "original/"）の場合は、input.filename の実ファイルを返す
                if src.is_dir():
                    orig_name = Path(str(inp.get("filename") or "")).name
                    if orig_name == "":
                        self._send(404, b"input.filename not found in manifest", "text/plain; charset=utf-8")
                        return

                    src_file = (src / orig_name).resolve()

                    if not str(src_file).startswith(str(target_path) + os.sep):
                        self._send(403, b"forbidden: invalid original file path", "text/plain; charset=utf-8")
                        return

                    if not src_file.exists():
                        self._send(404, b"original js file not found in original/", "text/plain; charset=utf-8")
                        return

                    body = src_file.read_text(encoding="utf-8").encode("utf-8")
                    self._send(200, body, "text/plain; charset=utf-8")
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

        # ------------------------------------------------------------
        # ★ 複数ファイルI/F（files / sources）対応
        # ------------------------------------------------------------
        # 互換: 従来どおり filename/content も受け付ける
        files_raw = req.get("files")
        sources_raw = req.get("sources")

        files: List[dict] = []
        sources: List[dict] = []

        if isinstance(files_raw, list):
            for it in files_raw:
                if isinstance(it, dict):
                    fn = str(it.get("filename") or "").strip()
                    ct = str(it.get("content") or "")
                    if fn != "" and ct != "":
                        files.append({"filename": fn, "content": ct})

        if isinstance(sources_raw, list):
            for it in sources_raw:
                if isinstance(it, dict):
                    fn = str(it.get("filename") or "").strip()
                    ct = str(it.get("content") or "")
                    if fn != "" and ct != "":
                        sources.append({"filename": fn, "content": ct})

        # 互換用の単体入力
        filename = str(req.get("filename") or "input.js")
        content = str(req.get("content") or "")

        if self.path == "/api/check":
            # check は単体チェック（UI側で複数チェックしたい場合は複数回呼ぶ想定）
            if content == "":
                body = json.dumps({"ok": False, "error": "content is empty"}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            lower = str(filename or "").lower().strip()

            if lower.endswith(".py"):
                ok, msg = check_py_syntax_with_py_compile(filename=filename, content=content)
                body = json.dumps({"ok": bool(ok), "error": "" if ok else str(msg)}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            ok, msg = check_js_syntax_with_node(filename=filename, content=content)
            body = json.dumps({"ok": bool(ok), "error": "" if ok else str(msg)}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return

        if self.path == "/api/extract":
            # 抽出は「ファイル全文」から行う（splitとは別）
            # - 単体: content
            # - 複数: sources + extract_from（選択対象）
            if content == "" and not sources:
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

            # ------------------------------------------------------------
            # ★ 抽出元の選択（チェックボックス想定）
            # - 単体: content を1ソースとして扱う
            # - 複数: sources を使い、extract_from に含まれる filename だけを対象にする
            # ------------------------------------------------------------
            def _extract_log_summary(stage: str, info: dict) -> None:
                """
                extract のログを「要点だけ」にする。
                - 1ステージ = 1行（短い）
                - payload 全部は出さない（巨大ログ防止）
                """
                try:
                    # 重要フィールドだけを固定順で出す（見やすさ優先）
                    keys = [
                        "sources_count",
                        "extract_from_count",
                        "selected_count",
                        "symbols_count",
                        "needles_count",
                        "context_lines",
                        "max_matches",
                        "selected_filenames",
                        "reason",
                    ]
                    brief = {k: info.get(k) for k in keys if k in info}
                    print("[EXTRACT][SUM]", stage, json.dumps(brief, ensure_ascii=False))
                except Exception:
                    try:
                        print("[EXTRACT][SUM]", stage, str(info))
                    except Exception:
                        pass

            def _extract_log_warn(stage: str, info: dict) -> None:
                """
                例外系だけは WARN で出す（ただし巨大dumpは禁止）。
                - 文字列が長すぎる場合は強制的に短縮する。
                - リストが長すぎる場合は先頭だけにする。
                """
                def _shrink(v):
                    try:
                        if isinstance(v, str):
                            if len(v) > 240:
                                return v[:240] + "...(truncated)"
                            return v
                        if isinstance(v, list):
                            if len(v) > 20:
                                head = v[:20]
                                return head + ["...(truncated)"]
                            return [_shrink(x) for x in v]
                        if isinstance(v, dict):
                            out = {}
                            for k, vv in v.items():
                                out[str(k)] = _shrink(vv)
                            return out
                        return v
                    except Exception:
                        return "(shrink_failed)"

                try:
                    safe_info = _shrink(info if isinstance(info, dict) else {"info": info})
                    print("[EXTRACT][WARN]", stage, json.dumps(safe_info, ensure_ascii=False))
                except Exception:
                    try:
                        print("[EXTRACT][WARN]", stage, str(info))
                    except Exception:
                        pass

            extract_from_raw = req.get("extract_from")
            extract_from: List[str] = []

            if isinstance(extract_from_raw, list):
                tmp: List[str] = []
                for x in extract_from_raw:
                    if isinstance(x, dict):
                        fnx = str(x.get("filename") or "").strip()
                        if fnx != "":
                            tmp.append(fnx)
                    else:
                        sx = str(x).strip()
                        if sx != "":
                            tmp.append(sx)
                extract_from = tmp
            elif isinstance(extract_from_raw, str):
                extract_from = [x.strip() for x in extract_from_raw.split(",") if x.strip() != ""]

            # ------------------------------------------------------------
            # ★ 要点ログ（巨大dump禁止）
            # ------------------------------------------------------------
            _extract_log_summary("request", {
                "sources_count": int(len(sources)),
                "extract_from_count": int(len(extract_from)),
                "symbols_count": int(len(symbols)),
                "needles_count": int(len(needles)),
                "context_lines": int(ctx_lines),
                "max_matches": int(max_matches),
            })

            selected_sources: List[dict] = []

            if sources:
                if extract_from:
                    allow = set(extract_from)

                    for it in sources:
                        fn_it = str(it.get("filename") or "")
                        if fn_it in allow:
                            selected_sources.append(it)
                else:
                    selected_sources = list(sources)
            else:
                selected_sources = [{"filename": filename, "content": content}]

            _extract_log_summary("select", {
                "sources_count": int(len(sources)),
                "extract_from_count": int(len(extract_from)),
                "selected_count": int(len(selected_sources)),
                "selected_filenames": [str(it.get("filename") or "") for it in selected_sources],
            })

            if sources and extract_from and len(selected_sources) == 0:
                _extract_log_warn("select_empty", {
                    "reason": "no sources matched extract_from",
                    "extract_from_list": list(extract_from),
                    "sources_filenames": [str(it.get("filename") or "") for it in sources],
                })
                body = json.dumps({"ok": False, "error": "no sources selected by extract_from"}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            results = []

            for src in selected_sources:
                src_filename = str(src.get("filename") or "input.js")
                src_content = str(src.get("content") or "")

                blocks = []

                # 1) 関数まるごと抽出（拡張子で JS / Python を切替）
                src_lower = str(src_filename or "").lower().strip()

                for name in symbols:
                    if src_lower.endswith(".py"):
                        found, header, body = extract_python_block_whole(py_text=src_content, name=name)
                        blocks.append({
                            "kind": "python_block_whole",
                            "name": name,
                            "found": bool(found),
                            "header": f"SOURCE_FILE: {src_filename} | {str(header)}",  # 追加した処理: 抽出元ファイル名をヘッダに埋め込み、UI表示だけで由来が分かるようにする
                            "text": str(body),
                            "sha256": sha256_hex(str(body)) if found else "",
                        })
                    else:
                        found, header, body = extract_function_whole(js_text=src_content, name=name)
                        blocks.append({
                            "kind": "function_whole",
                            "name": name,
                            "found": bool(found),
                            "header": f"SOURCE_FILE: {src_filename} | {str(header)}",  # 追加した処理: 抽出元ファイル名をヘッダに埋め込み、UI表示だけで由来が分かるようにする
                            "text": str(body),
                            "sha256": sha256_hex(str(body)) if found else "",
                        })

                # 2) 呼び出し周辺抽出
                for nd in needles:
                    hit_count, ctx_blocks = extract_context_around(
                        js_text=src_content,
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
                                "header": f"SOURCE_FILE: {src_filename} | {str(h)}",  # 追加した処理: 各コンテキスト断片のヘッダにも抽出元ファイル名を付与する
                                "text": str(t),
                                "sha256": sha256_hex(str(t)),
                            }
                            for (h, t) in ctx_blocks
                        ],
                    })

                results.append({
                    "filename": src_filename,
                    "blocks": blocks,
                })

            # ------------------------------------------------------------
            # ★ 後方互換（legacy fields）
            # ------------------------------------------------------------
            # 既存UIが resp.filename / resp.blocks を前提にしている可能性が高い。
            # results が 1件のときは先頭をトップレベルへ併記する。
            first_filename = ""
            first_blocks = []
            if isinstance(results, list) and len(results) > 0:
                first = results[0] if isinstance(results[0], dict) else None
                if first:
                    first_filename = str(first.get("filename") or "")
                    fb = first.get("blocks")
                    if isinstance(fb, list):
                        first_blocks = fb

            resp = {
                "ok": True,
                "symbols": symbols,
                "needles": needles,
                "context_lines": int(ctx_lines),
                "max_matches": int(max_matches),
                "extract_from": extract_from,
                "results": results,

                # legacy fields（単体表示用）
                "filename": first_filename,
                "blocks": first_blocks,
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

        # 追加した処理: SCOPE CHECK 用の抽出コード（UI入力）
        # - split対象のJS本文に混ぜない
        # - 最終パート（EXEC_TASK）にだけ固定挿入するため、ここで受け取って下流へ渡す
        scope_extract_code = str(req.get("scope_extract_code") or "")

        project_id = str(req.get("project_id") or "").strip()
        task_id = str(req.get("task_id") or "").strip()

        include_rules_raw = req.get("include_rules")
        include_rules = bool(include_rules_raw) if include_rules_raw is not None else False

        if instruction.strip() == "":
            # 生成時に instruction が空なら拒否する（空EXEC_TASK防止）
            self._send(400, b"instruction is empty", "text/plain; charset=utf-8")
            return

        outroot = Path(__file__).resolve().parent / DEFAULT_OUTROOT
        safe_mkdir(outroot)

        # ------------------------------------------------------------
        # ★ split 対象の選択
        # - 複数: files
        # - 単体: filename/content
        # ------------------------------------------------------------
        split_targets: List[dict] = []
        if files:
            split_targets = list(files)
        else:
            if content == "":
                self._send(400, b"content is empty", "text/plain; charset=utf-8")
                return
            split_targets = [{"filename": filename, "content": content}]

        try:
            session_id, out_dir, parts, payloads = generate_parts(
                split_targets=split_targets,
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
                scope_extract_code=scope_extract_code,
            )
        except Exception as e:
            self._send(500, f"Split failed: {e}".encode("utf-8"), "text/plain; charset=utf-8")
            return

        # ★ 追加した処理: UI 互換のため results を “ファイル別” にも組み立てる
        results = []

        # payloads は global_index-1 で取れる
        for tgt in split_targets:
            t_filename = str(tgt.get("filename") or "input.js")
            file_parts = [p for p in parts if str(p.source_filename) == t_filename]

            results.append({
                "filename": t_filename,
                "session_id": session_id,
                "output_dir": str(out_dir),
                "parts": [
                    {
                        "index": int(p.global_index),
                        "total": int(p.global_total),
                        "part_id": p.part_id,

                        "source_filename": str(p.source_filename),
                        "file_tag": str(p.file_tag),

                        "part_sha256": p.part_sha256,
                        "part_sha8": p.part_sha256[:8].upper(),

                        "start_offset": p.start_offset,
                        "end_offset": p.end_offset,
                        "len_chars": len(p.text),
                        "payload": payloads[int(p.global_index) - 1],
                    }
                    for p in file_parts
                ],
            })

        # ★ 生成対象が1件も無い場合はエラー（UI側の想定外クラッシュ防止）
        if len(results) == 0:
            self._send(400, b"no valid input files (all contents were empty?)", "text/plain; charset=utf-8")
            return

        # ------------------------------------------------------------
        # ★ 後方互換を強制
        # ------------------------------------------------------------
        # 従来UIはトップレベルの session_id/output_dir/parts を前提にしている可能性が高い。
        # ここで返す parts は「全体パート列（PROTOCOL_PREAMBLE / JS本体 / 追加パート / EXEC_TASK）」を必ず含める。
        # そうすることで manifest.json の total_parts と API の parts 件数が一致し、「7のはずが5」問題を根絶する。
        first = results[0]

        all_parts = [
            {
                "index": int(p.global_index),
                "total": int(p.global_total),
                "part_id": p.part_id,

                "source_filename": str(p.source_filename),
                "file_tag": str(p.file_tag),

                "part_sha256": p.part_sha256,
                "part_sha8": p.part_sha256[:8].upper(),

                "start_offset": p.start_offset,
                "end_offset": p.end_offset,
                "len_chars": len(p.text),
                "payload": payloads[int(p.global_index) - 1],
            }
            for p in parts
        ]

        resp = {
            "ok": True,
            "session_id": str(first.get("session_id") or ""),
            "output_dir": str(first.get("output_dir") or ""),
            "parts": all_parts,
            "results": results,
            "multi": bool(len(results) > 1),
        }

        body = json.dumps(resp, ensure_ascii=False).encode("utf-8")
        self._send(200, body, "application/json; charset=utf-8")
        return


def main() -> None:
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    print("OK")
    print(f"Local Tool URL: http://{BIND_HOST}:{BIND_PORT}/")
    print(f"Output root: {Path(__file__).resolve().parent / DEFAULT_OUTROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()