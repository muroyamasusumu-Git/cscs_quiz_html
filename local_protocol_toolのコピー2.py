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

    # このパート本文の SHA256（貼り間違い・改ざん検出用）
    part_sha256: str

    # 人間が貼り間違いに気づくための可視ヒント
    first_line: str
    last_line: str


def sha256_hex(s: str) -> str:
    h = hashlib.sha256()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


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
) -> List[Tuple[int, int, str]]:
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

    parts: List[Tuple[int, int, str]] = []
    start = 0

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
                # --- 境界優先分割（従来） ---
                boundary_candidates = [
                    "\n})();\n",
                    "\n});\n",
                    "\n}\n",
                ]

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
                    nl = text.rfind("\n", start, tentative_end)
                    if nl == -1 or nl <= start:
                        end = tentative_end
                    else:
                        end = nl + 1

            # ★ 追加した処理: 最終的な end は必ず「改行境界」に丸めて、行の途中で切らない
            end = _snap_end_to_newline(start, end)

        chunk = text[start:end]
        parts.append((start, end, chunk))
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
) -> None:
    manifest = {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "instruction": str(instruction),
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


HTML_PAGE = r"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Protocol Splitter Local Tool</title>
  <style>
    :root{
      --bg: #0b0d10;
      --panel: #11151b;
      --panel2: #0f1217;
      --border: #242b36;
      --text: #e7eaf0;
      --muted: #9aa4b2;
      --codebg: #0a0c10;

      /* 見出しの水色（.sectionTitle と合わせる） */
      --accent: rgba(125, 211, 252, 0.95);
      /* ホバー等で少し弱めに使う水色 */
      --accentSoft: rgba(125, 211, 252, 0.70);

      --focus: #3b82f6;
      --ok: #22c55e;
      --danger: #ef4444;
    }

    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans JP";
      font-size: 15px; /* 全体の基準文字サイズを少し上げて読みやすくする */
      line-height: 1.65; /* 行間を広げて可読性を上げる */
      letter-spacing: 0.01em; /* わずかに字間を広げて読みやすくする */
      margin: 16px;
      background: radial-gradient(1200px 600px at 30% -10%, #111827 0%, var(--bg) 55%);
      color: var(--text);
    }

    h2 {
      margin: 6px 0 10px;
      font-size: 20px; /* 見出しとして視認性を上げる */
      line-height: 1.25; /* 見出しの詰まりを防ぐ */
      letter-spacing: 0.02em; /* 見出しは少し字間を広げる */
      text-align: center;
    }

    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }

    .card {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      margin: 12px 0;

      /* 各 card ごとの色味調整用（デフォルト） */
      background: linear-gradient(
        180deg,
        var(--card-panel, var(--panel)) 0%,
        var(--card-panel2, var(--panel2)) 100%
      );

      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }

    /* JSファイルブロックのカードだけ、ほんの少し明るくする */
    .card.card-file {
      --card-panel:  #16202a;
      --card-panel2: #141d27;
    }

    /* ============================================================
       card ごとの色味バリエーション（並び順ベース）
       ------------------------------------------------------------
       目的:
         - 視線誘導の補助
         - セクション境界を直感的に分かりやすくする
         - コントラストは変えず、色相のみを微調整
    ============================================================ */

    .card:nth-of-type(1n) {
      --card-panel:  #11151b; /* 基本（既存） */
      --card-panel2: #0f1217;
    }

    .card:nth-of-type(2n) {
      --card-panel:  #101824; /* わずかに青寄り */
      --card-panel2: #0e141d;
    }

    .card:nth-of-type(3n) {
      --card-panel:  #121826; /* 少しシアン寄り */
      --card-panel2: #101624;
    }

    .card:nth-of-type(4n) {
      --card-panel:  #141827; /* わずかに紫寄り */
      --card-panel2: #121524;
    }

    textarea {
      box-sizing: border-box; /* padding/border込みでwidth計算し、親からはみ出さないようにする */
      width: 100%;
      min-height: 140px;
      font-size: 14px; /* 入力文字を読みやすくする */
      line-height: 1.6; /* 入力欄の行間を少し広げる */
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Noto Sans Mono";
      background: #0c1016;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px; /* 視認性のため少し余白を増やす */
      outline: none;

      overflow: hidden; /* 内部スクロールを発生させない */
      resize: none;     /* 手動リサイズを無効化（高さはJSで自動） */
    }

    select, input[type="number"], input#prefix {
      box-sizing: border-box; /* input/selectも同様に、横はみ出し防止 */
      width: 100%; /* 4列の各セル内に確実に収める */
      font-size: 14px; /* ラベル/入力値を読みやすくする */
      line-height: 1.4; /* 高さのバランスを整える */
      padding: 9px 10px; /* 視認性のため少しだけ余白を増やす */
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0c1016;
      color: var(--text);
      outline: none;
      height: 34px;
    }

    /* extract: カンマ区切り入力は「大きめ」にする（打ちやすさ優先） */
    input#extractSymbols, input#extractNeedles, input#extractPurpose, input#extractDepends {
      box-sizing: border-box;
      width: 100%;
      font-size: 14px;
      line-height: 1.4;
      padding: 11px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0c1016;
      color: var(--text);
      outline: none;
      height: 44px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Noto Sans Mono";
    }
    
    /* =========================
   全 input の placeholder を薄くする
   ========================= */

    input::placeholder {
      color: rgba(231, 234, 240, 0.30);
      opacity: 1; /* Safari / Chrome 対策 */
    }
    
    /* Firefox 対応 */
    input::-moz-placeholder {
      color: rgba(231, 234, 240, 0.30);
      opacity: 1;
    }
    
    /* Edge / 旧仕様互換（念のため） */
    input:-ms-input-placeholder {
      color: rgba(231, 234, 240, 0.30);
    }

    /* extract: 数値2つは「小さめ」にする（面積を取りすぎない） */
    input#extractContextLines, input#extractMaxMatches {
      box-sizing: border-box;
      width: 100%;
      font-size: 12px;
      line-height: 1.2;
      padding: 6px 8px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0c1016;
      color: var(--text);
      outline: none;
      height: 30px;
    }

    input[type="file"] {
      color: var(--muted);
    }

    textarea:focus, select:focus, input[type="number"]:focus, input#prefix:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.18);
    }

    button {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0c1016;
      color: var(--text);
      font-size: 14px; /* ボタン文字の読みやすさを上げる */
      line-height: 1.2; /* ボタン内の縦詰まりを防ぐ */
      transition: transform 80ms ease, box-shadow 120ms ease, border-color 120ms ease, background 120ms ease, opacity 120ms ease;
      box-shadow: 0 8px 18px rgba(0,0,0,0.35);
      user-select: none;
      cursor: pointer;
    }

    /* 指定ボタン（生成 / 抽出 / 入力モード切替 / このパートをコピー / 次のパートを表示）：横幅を大きくして押しやすくする */
    #run, #runExtract, #copyCurrent, #copyNext, #copyExtract, #modeSplitBtn, #modeExtractBtn {
      min-width: 220px;     /* 横幅を確保（画面幅が狭い時は折り返しに任せる） */
      padding-left: 16px;   /* 見た目の“横に大きい”感を出す */
      padding-right: 16px;  /* 同上 */
    }

    /* マウスオーバー時：ボーダー色を見出しの水色に合わせる */
    button:hover {
      border-color: var(--accentSoft);
      box-shadow: 0 10px 22px rgba(0,0,0,0.45);
    }

    button:active {
      transform: translateY(1px) scale(0.99);
      box-shadow: 0 4px 10px rgba(0,0,0,0.35);
    }

    /* ON（強調）状態：primary のボーダー色も見出し水色に合わせる */
    button.primary {
      border-color: var(--accent);
      box-shadow: 0 12px 26px rgba(125,211,252,0.10), 0 10px 22px rgba(0,0,0,0.45);
    }

    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }

    button.flash-ok {
      border-color: rgba(34,197,94,0.9);
      box-shadow: 0 0 0 3px rgba(34,197,94,0.18), 0 12px 26px rgba(0,0,0,0.45);
    }

    button.flash-ng {
      border-color: rgba(239,68,68,0.9);
      box-shadow: 0 0 0 3px rgba(239,68,68,0.18), 0 12px 26px rgba(0,0,0,0.45);
    }

    @keyframes partSwitchPulse {
      0% {
        box-shadow: 0 0 0 0 rgba(125,211,252,0.00);
        border-color: var(--border);
      }
      40% {
        box-shadow: 0 0 0 4px rgba(125,211,252,0.20);
        border-color: var(--accent);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(125,211,252,0.00);
        border-color: var(--border);
      }
    }

    .flash-part-switch {
      animation: partSwitchPulse 520ms ease-out 1;
      border-radius: 14px;
    }

    pre {
      background: var(--codebg);
      color: #e8edf7;
      padding: 12px;
      margin: 5px 0;
      border-radius: 14px;
      overflow: auto;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      font-size: 13px; /* コードを読みやすくする */
      line-height: 1.55; /* コード行間を確保する */
    }

    .muted { color: var(--muted); }

    .sectionTitle {
      font-weight: 700; /* 見出しを太字 */
      color: rgba(125, 211, 252, 0.95); /* 水色っぽい（少し淡いシアン） */
      margin-bottom: 5px;
      font-size: 18px; 
    }

    .sectionTitleHist {
      color: rgba(231,234,240,0.78); /* 白で薄く（過去の指示 見出しだけ） */
    }

    .currentPartMeta {
      color: rgba(231,234,240,0.72); /* 白で薄め（情報表示用） */
      font-weight: 400;             /* 見出しより軽く */
    }

    .histMeta {
      font-size: 11px; /* 参照先などの補助情報は小さく */
      line-height: 1.25;
      color: rgba(154,164,178,0.78); /* さらに薄め */
    }

    .parts { display: grid; grid-template-columns: 1fr; gap: 6px; }

    /* パート一覧（#partsList）だけ、カード同士の上下余白を詰める */
    #partsList .card {
      margin: 0;      /* .card の 12px 0 を打ち消す */
      padding: 10px;  /* ついでに少し詰めたいなら。不要なら消してOK */
    }

    .partHeader { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

    .partTitleRow {
      display: flex;
      align-items: baseline;
      justify-content: space-between; /* 右端にパート切替ボタン列を置く */
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 0px;
    }

    .partJump {
      display: flex;              /* パート番号ボタン列 */
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      min-width: 0;
    }

    .partJumpBtn {
      padding: 6px 10px;          /* 小さめの番号ボタン */
      min-width: 38px;
      border-radius: 999px;
      font-size: 13px;
      line-height: 1.1;
    }

    .pillBig {
      font-size: 14px;     /* ← ここが視認性UPの本体 */
      padding: 6px 10px;   /* ← pill自体も少し大きく */
      color: var(--text);  /* 重要情報は少し白寄せ */
    }

    .pill {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      color: var(--muted);
    }

    #status {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
    }

    body.dragover {
      outline: 2px dashed rgba(59,130,246,0.85); /* ドラッグ中であることを分かりやすく表示する */
      outline-offset: 10px; /* 画面端から少し内側に表示して視認性を上げる */
    }
    
    details.adv {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.02);
    }

    summary.advSummary {
      cursor: pointer;
      user-select: none;
      color: var(--text);
      font-weight: 600;
      list-style: none;
      outline: none;
    }

    summary.advSummary::-webkit-details-marker {
      display: none;
    }

    summary.advSummary::before {
      content: "▶";
      display: inline-block;
      margin-right: 8px;
      color: var(--muted);
      transform: translateY(-1px);
    }

    details[open] > summary.advSummary::before {
      content: "▼";
    }
    
    .advGrid {
      display: grid;
      gap: 6px;
      align-items: end;

      /* 4列が成立する時だけ4列（1カラムの最低幅を小さくして4列成立しやすくする） */
      grid-template-columns: repeat(4, minmax(100px, 1fr));
    }

    /* 4列が成立しない幅になったら、必ず縦1列 */
    @media (max-width: 400px) {
      .advGrid {
        grid-template-columns: 1fr;
      }
    }

    .advItem {
      min-width: 0; /* grid内で要素がはみ出すのを防ぐ */
    }

    .splitModePick {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 9px 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0c1016;
      color: var(--text);
      min-height: 34px;
      box-sizing: border-box;
      user-select: none;
      cursor: pointer;
    }

    .splitModePick input[type="radio"] {
      transform: translateY(1px);
    }

    .splitModeDesc {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.35;
      color: rgba(154,164,178,0.86);
    }

    /* ============================================================
       履歴（過去の指示）だけ：視認性を下げて“詰める”
       ------------------------------------------------------------
       目的:
         - フォントを小さめ
         - 行間を詰める
         - 余白/カード間隔を詰める
         - ボタン・pillも小さめ
         ※ 他の .card / pre / .partHeader には影響させない
    ============================================================ */
    #instructionHistory .card {
      padding: 8px;
      margin: 0px 0px;
      border-radius: 12px;
    }

    #instructionHistory .partHeader {
      gap: 6px;
      margin-bottom: 6px;
    }

    #instructionHistory .pill {
      font-size: 10px;
      padding: 2px 6px;
    }

    #instructionHistory button {
      padding: 6px 8px;
      font-size: 11px;
      line-height: 1.15;
      border-radius: 10px;
      box-shadow: 0 6px 14px rgba(0,0,0,0.28);
    }

    #instructionHistory pre {
      padding: 8px;
      font-size: 9px;
      line-height: 1.35;
      border-radius: 12px;
      margin: 0;
      color: rgba(231,234,240,0.72); /* 履歴本文だけ薄くする */

      /* ===== はみ出し防止（ここが本体） ===== */
      box-sizing: border-box;
      max-width: 100%;
      min-width: 0;

      /* 横スクロールにせず折り返す */
      overflow-x: hidden;
      overflow-y: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    #instructionHistory .pill {
      color: rgba(154,164,178,0.72); /* pill もさらに薄く */
    }

    #instructionHistory .muted {
      color: rgba(154,164,178,0.68); /* 履歴内の muted も薄く */
    }

    #instructionHistory button {
      color: rgba(231,234,240,0.78); /* ボタン文字も少し薄く */
    }

    /* extract 専用グリッド：2行×2列 */
    .extractGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-auto-rows: auto;
      gap: 10px 14px;
    }

    /* 上段（symbols / needles）は少し広く見せたい */
    .extractWide {
      min-height: 72px;
    }

    /* 下段（数値）はコンパクトに */
    .extractNarrow {
      min-height: 48px;
    }
    
    /* extract結果表示専用：長文なのでスクロール可＋高さを確保 */
    textarea#extractPreview {
      min-height: 340px;
      overflow: auto;
      resize: vertical;
    }
    
  </style>
</head>
<body>
  <h2>Protocol Splitter（ローカル専用）</h2>
  <div class="muted">① assets内のJSを選ぶ（ドラッグ&ドロップも可） → ② 指示を書く → ③ 生成 → ④ パートを表示してコピー</div>

  <div class="card card-file">
    <div class="row">
      <div>
        <div class="muted sectionTitle">JSファイル</div>
        <input id="file" type="file" accept=".js,.mjs,.cjs,.txt" />
      </div>
    </div>

    <details class="adv" style="margin-top:10px;">
      <summary class="advSummary">詳細設定（Prefix / Lang / split制限）</summary>

      <div class="advGrid" style="margin-top:10px;">
        <div class="advItem">
          <div class="muted">Prefix</div>
          <input id="prefix" value="CSCSJS" />
        </div>
        <div class="advItem">
          <div class="muted">Lang</div>
          <select id="lang">
            <option value="javascript">javascript</option>
            <option value="text">text</option>
          </select>
        </div>
        <div class="advItem">
          <div class="muted">maxchars</div>
          <input id="maxchars" type="number" value="60000" />
        </div>
        <div class="advItem">
          <div class="muted">maxlines</div>
          <input id="maxlines" type="number" value="1200" />
        </div>

        <div class="advItem">
          <div class="muted">maxlogs</div>
          <input id="maxlogs" type="number" value="50" />
        </div>

        <div class="advItem">
          <div class="muted">splitMode (C)</div>
          <label class="splitModePick">
            <input type="radio" name="splitModeRadio" value="C">
            <span>C: 通常</span>
          </label>
          <div class="muted splitModeDesc">
            上限（maxchars/maxlines）をまず守る方針。上限内の末尾付近で
            <code style="color:rgba(231,234,240,0.88);">})();</code> /
            <code style="color:rgba(231,234,240,0.88);">});</code> /
            <code style="color:rgba(231,234,240,0.88);">}</code>
            など“境界っぽい行”を後方探索し、見つからなければ改行で切る。
            サイズは安定するが、IIFEの途中で切れる可能性がある。
          </div>
        </div>

        <div class="advItem">
          <div class="muted">splitMode (B)</div>
          <label class="splitModePick">
            <input type="radio" name="splitModeRadio" value="B">
            <span>B: ハイブリッド</span>
          </label>
          <div class="muted splitModeDesc">
            上限付近から <b style="color:rgba(231,234,240,0.88);">上限+30%</b> まで「少し粘って」
            IIFE終端 <code style="color:rgba(231,234,240,0.88);">})();</code> を探す。
            見つかれば“キレイに切る”、見つからなければ改行で切ってサイズを安定させる。
            運用が一番バランス良く、破綻しにくい。
          </div>
        </div>

        <div class="advItem">
          <div class="muted">splitMode (A)</div>
          <label class="splitModePick">
            <input type="radio" name="splitModeRadio" value="A">
            <span>A: IIFE終端最優先</span>
          </label>

          <input type="hidden" id="splitMode" value="C" />

          <div class="muted splitModeDesc">
            IIFE終端 <code style="color:rgba(231,234,240,0.88);">})();</code> を最優先で探して「そこで切る」。
            上限は“目安”になりやすく、巨大IIFEだと 1パートが上限を大幅に超えて大きくなることがある。
            その代わり「IIFE途中で切って壊す」リスクを強く避けられる。
          </div>
        </div>
      </div>
    </details>

    <div style="margin-top:12px;">
      <div class="row" style="align-items:center;">
        <div class="muted sectionTitle" style="margin-bottom:0;">入力モード</div>
        <button class="primary" id="modeSplitBtn" type="button">指示（--instruction）</button>
        <button id="modeExtractBtn" type="button">symbols / needles</button>
      </div>

      <!-- Split（指示）入力欄 -->
      <div id="modeSplitBox" style="margin-top:10px;">
        <div class="muted sectionTitle">指示（--instruction）</div>
        <textarea id="instruction" placeholder="ここに作業指示を書く（この内容が最終パートの EXEC_TASK になる）"></textarea>
      </div>

      <!-- Extract（symbols/needles）入力欄 -->
      <div id="modeExtractBox" style="margin-top:10px; display:none;">
        <div class="muted sectionTitle">symbols / needles（extract用）</div>

        <div class="advGrid extractGrid" style="margin-top:10px;">
          <!-- 上段：文字系（横2列） -->
          <div class="advItem extractWide">
            <div class="muted">EXTRACT_SYMBOLS（必須 / カンマ区切り）</div>
            <input id="extractSymbols" value="" placeholder="例: split_by_limits, build_exec_task_block" />
          </div>

          <div class="advItem extractWide">
            <div class="muted">EXTRACT_NEEDLES（カンマ区切り / 空も可）</div>
            <input id="extractNeedles" value="" placeholder="例: SCOPE_INDEX, RECEIPT_CHECK" />
          </div>

          <!-- 追加した処理: 抽出の目的（LLMの判断ブレ低減）を1行で添える -->
          <div class="advItem extractWide">
            <div class="muted">PURPOSE（1行）</div>
            <input id="extractPurpose" value="" placeholder="例: createPanel 内の「手動送信クリック後HUD再描画」周辺を修正したい" />
          </div>

          <!-- 追加した処理: 依存関数/依存データの“存在だけ”をメタで列挙（中身不要） -->
          <div class="advItem extractWide">
            <div class="muted">DEPENDS（カンマ区切り / 任意）</div>
            <input id="extractDepends" value="" placeholder="例: fetchState, renderPanel, readIntFromLocalStorage, computePendingFlags, info.qid" />
          </div>

          <!-- 下段：数値系（横2列） -->
          <div class="advItem extractNarrow">
            <div class="muted">EXTRACT_CONTEXT_LINES</div>
            <input id="extractContextLines" type="number" value="25" />
          </div>

          <div class="advItem extractNarrow">
            <div class="muted">EXTRACT_MAX_MATCHES</div>
            <input id="extractMaxMatches" type="number" value="50" />
          </div>
        </div>

        <div class="muted" style="margin-top:8px;">
          ※ symbols は「関数まるごと抽出」対象、needles は「周辺行抽出」対象（複数指定OK）
        </div>
      </div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button class="primary" id="run">生成（split）</button>
      <button id="runExtract" style="display:none;">抽出（extract）</button>
      <button id="copyExtract" style="display:none;" disabled>抽出結果をコピー</button>
      <button id="resetExtract" style="display:none;" disabled>抽出をリセット</button>
      <button id="copyNext" disabled>次のパートを表示</button>
      <button id="resetGen" disabled>生成をリセット</button>
      <span class="muted" id="status" style="display:none;"></span>
    </div>
  </div>

  <!-- Split（分割）モード用：現在のパート -->
  <div class="card" id="currentPartCard">
    <div class="partTitleRow">
      <div class="muted sectionTitle" id="currentPartTitle">
        <span class="currentPartLabel">現在のパート</span>
        <span class="currentPartMeta">　Part: - / -　(SessionID: -)</span>
      </div>

      <!-- 右端：パート番号ボタン -->
      <div id="partJump" class="partJump"></div>
    </div>

    <div class="partHeader">
      <span class="pill pillBig" id="pidPill">PartID: -</span>
      <span class="pill pillBig" id="sha8Pill">SHA8: -</span>
      <button id="copyCurrent" disabled>このパートをコピー</button>
      <button id="toggleAll" disabled>ALL: OFF</button>
    </div>
    <pre id="preview">(まだ生成していません)</pre>
  </div>

  <!-- Extract（抽出）モード用：抽出結果専用 -->
  <div class="card" id="extractResultCard" style="display:none;">
    <div class="muted sectionTitle">抽出結果（extract）</div>
    <div class="muted" style="margin-top:6px;">※ ここに <<<EXTRACT_BEGIN>>> から全部出ます（そのままコピペ用途）</div>
    <textarea id="extractPreview" readonly placeholder="(まだ抽出していません)"></textarea>

    <!-- 追加した処理: FOUND:false をコピー対象外の“小ログ”として textarea 外に表示する -->
    <div class="muted" id="extractNotFoundLog"
         style="margin-top:10px; font-size:12px; line-height:1.35; white-space:pre-wrap; opacity:0.85;">
    </div>
  </div>

  <div class="card">
    <div class="muted sectionTitle">パート一覧</div>
    <div class="parts" id="partsList"></div>
  </div>

  <div class="card">
    <div class="muted sectionTitle sectionTitleHist">過去の指示（--instruction）</div>
    <div class="muted histMeta" id="histRoot" style="margin-top:6px;">参照先: （未取得）</div>
    <div class="row" style="margin-top:10px;">
      <button id="histClear">履歴クリア</button>
      <span class="muted" id="histStatus"></span>
    </div>
    <div class="parts" id="instructionHistory" style="margin-top:6px;"></div>
  </div>

<script>
  const $ = (id) => document.getElementById(id);

  const UI_STATE_KEY = "protocol_splitter_ui_state_v1";

  function loadUiState() {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function saveUiState() {
    try {
      const s = {
        prefix: String(($("prefix") && $("prefix").value) || ""),
        lang: String(($("lang") && $("lang").value) || ""),
        maxchars: Number(($("maxchars") && $("maxchars").value) || 0),
        maxlines: Number(($("maxlines") && $("maxlines").value) || 0),
        maxlogs: Number(($("maxlogs") && $("maxlogs").value) || 0),
        splitMode: String(($("splitMode") && $("splitMode").value) || "C"),
        instruction: String(($("instruction") && $("instruction").value) || ""),
        uiMode: String((window.__uiMode || "split")),
        extractSymbols: String(($("extractSymbols") && $("extractSymbols").value) || ""),
        extractNeedles: String(($("extractNeedles") && $("extractNeedles").value) || ""),
        /* 追加した処理: 抽出結果に PURPOSE を確実に添えるため、UI状態として保存 */
        extractPurpose: String(($("extractPurpose") && $("extractPurpose").value) || ""),
        /* 追加した処理: 抽出結果に DEPENDS を確実に添えるため、UI状態として保存 */
        extractDepends: String(($("extractDepends") && $("extractDepends").value) || ""),
        extractContextLines: Number(($("extractContextLines") && $("extractContextLines").value) || 25),
        extractMaxMatches: Number(($("extractMaxMatches") && $("extractMaxMatches").value) || 50),
        currentIndex: Number(currentIndex || 0),
        previewAllOn: !!previewAllOn,
      };
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function restoreUiState() {
    const s = loadUiState();
    if (!s) return;

    if ($("prefix") && typeof s.prefix === "string" && s.prefix) {
      $("prefix").value = s.prefix;
    }
    if ($("lang") && typeof s.lang === "string" && s.lang) {
      $("lang").value = s.lang;
    }
    if ($("maxchars") && typeof s.maxchars === "number" && s.maxchars > 0) {
      $("maxchars").value = String(s.maxchars);
    }
    if ($("maxlines") && typeof s.maxlines === "number" && s.maxlines > 0) {
      $("maxlines").value = String(s.maxlines);
    }
    if ($("maxlogs") && typeof s.maxlogs === "number" && s.maxlogs > 0) {
      $("maxlogs").value = String(s.maxlogs);
    }

    if ($("splitMode") && typeof s.splitMode === "string" && s.splitMode) {
      $("splitMode").value = s.splitMode;

      const radios = document.querySelectorAll('input[name="splitModeRadio"]');
      for (let i = 0; i < radios.length; i++) {
        const r = radios[i];
        const v = String(r && r.value ? r.value : "");
        r.checked = (v === s.splitMode);
      }
    }

    if ($("instruction") && typeof s.instruction === "string") {
      $("instruction").value = s.instruction;
    }

    if ($("extractSymbols") && typeof s.extractSymbols === "string") {
      $("extractSymbols").value = s.extractSymbols;
    }
    if ($("extractNeedles") && typeof s.extractNeedles === "string") {
      $("extractNeedles").value = s.extractNeedles;
    }
    /* 追加した処理: PURPOSE / DEPENDS も復元して、抽出コピーの定型が崩れないようにする */
    if ($("extractPurpose") && typeof s.extractPurpose === "string") {
      $("extractPurpose").value = s.extractPurpose;
    }
    if ($("extractDepends") && typeof s.extractDepends === "string") {
      $("extractDepends").value = s.extractDepends;
    }
    if ($("extractContextLines") && (typeof s.extractContextLines === "number" || typeof s.extractContextLines === "string")) {
      const v = Number(s.extractContextLines);
      if (isFinite(v) && v >= 0) $("extractContextLines").value = String(v);
    }
    if ($("extractMaxMatches") && (typeof s.extractMaxMatches === "number" || typeof s.extractMaxMatches === "string")) {
      const v = Number(s.extractMaxMatches);
      if (isFinite(v) && v > 0) $("extractMaxMatches").value = String(v);
    }

    if (typeof s.previewAllOn === "boolean") {
      previewAllOn = s.previewAllOn;
    }

    if (typeof s.uiMode === "string" && s.uiMode) {
      window.__uiMode = s.uiMode;
    } else {
      window.__uiMode = "split";
    }
  }

  function restoreUiStatePostResult() {
    const s = loadUiState();
    if (!s) return;

    if (typeof s.currentIndex === "number" && isFinite(s.currentIndex)) {
      const idx = Math.max(0, Math.floor(s.currentIndex));
      if (result && result.parts && result.parts.length > 0) {
        currentIndex = Math.min(idx, result.parts.length - 1);
      } else {
        currentIndex = 0;
      }
    }
  }

  function autosizeInstruction() {
    const ta = $("instruction");
    if (!ta) return;

    ta.style.height = "auto";
    const next = ta.scrollHeight;
    ta.style.height = String(next) + "px";
  }

  function setFileFromDrop(file) {
    if (!file) return;

    const name = String(file.name || "");
    const okExt = /\.(js|mjs|cjs|txt)$/i.test(name);

    if (!okExt) {
      setStatus("非対応の拡張子です（.js/.mjs/.cjs/.txt）: " + name);
      return;
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    $("file").files = dt.files;

    setStatus("ファイル選択: " + name + "（ドラッグ&ドロップ）");
    runSyntaxCheckForFile(file);
  }

  window.addEventListener("dragover", (ev) => {
    ev.preventDefault(); /* drop を有効化する */
    document.body.classList.add("dragover"); /* ドラッグ中の視覚表現 */
  });

  window.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    document.body.classList.remove("dragover"); /* ドラッグ終了で解除 */
  });

  window.addEventListener("drop", (ev) => {
    ev.preventDefault(); /* ブラウザのデフォルト（開く/移動）を抑止する */
    document.body.classList.remove("dragover"); /* ドラッグ表現を解除 */

    const files = ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : null;
    if (!files || files.length === 0) {
      setStatus("ドロップされたファイルが見つかりません");
      return;
    }

    setFileFromDrop(files[0]); /* 先頭の1ファイルのみ扱う */
  });

  let result = null;
  let currentIndex = 0;

  let previewAllOn = false;

  /* extract結果（<<<EXTRACT_BEGIN>>>..<<<EXTRACT_END>>>）を保持してコピーできるようにする */
  let lastExtractText = "";
  
  window.__uiMode = "split";

  function applyUIMode(nextMode) {
    const mode = (String(nextMode || "") === "extract") ? "extract" : "split";
    window.__uiMode = mode;

    const splitBox = $("modeSplitBox");
    const extractBox = $("modeExtractBox");
    const btnSplit = $("modeSplitBtn");
    const btnExtract = $("modeExtractBtn");

    const btnRunSplit = $("run");
    const btnRunExtract = $("runExtract");

    if (splitBox) splitBox.style.display = (mode === "split") ? "" : "none";
    if (extractBox) extractBox.style.display = (mode === "extract") ? "" : "none";

    if (btnRunSplit) btnRunSplit.style.display = (mode === "split") ? "" : "none";
    if (btnRunExtract) btnRunExtract.style.display = (mode === "extract") ? "" : "none";

    const btnCopyExtract = $("copyExtract");
    if (btnCopyExtract) btnCopyExtract.style.display = (mode === "extract") ? "" : "none";

    const btnResetExtract = $("resetExtract");
    if (btnResetExtract) btnResetExtract.style.display = (mode === "extract") ? "" : "none";

    if (btnSplit) {
      if (mode === "split") btnSplit.classList.add("primary");
      else btnSplit.classList.remove("primary");
    }
    if (btnExtract) {
      if (mode === "extract") btnExtract.classList.add("primary");
      else btnExtract.classList.remove("primary");
    }

    /* 追加した処理: extractモード時は「現在のパート」カードを非表示にし、抽出結果カードに切り替える */
    const currentPartCard = $("currentPartCard");
    const extractResultCard = $("extractResultCard");
    if (currentPartCard) currentPartCard.style.display = (mode === "split") ? "" : "none";
    if (extractResultCard) extractResultCard.style.display = (mode === "extract") ? "" : "none";

    /* 追加した処理: extractモードでは split操作ボタンを無効化して誤操作を防ぐ */
    const btnCopyCurrent = $("copyCurrent");
    const btnCopyNext = $("copyNext");
    const btnToggleAll = $("toggleAll");
    if (btnCopyCurrent) btnCopyCurrent.disabled = (mode === "extract") ? true : !!(btnCopyCurrent.disabled && false);
    if (btnCopyNext) btnCopyNext.disabled = (mode === "extract") ? true : !!(btnCopyNext.disabled && false);
    if (btnToggleAll) btnToggleAll.disabled = (mode === "extract") ? true : !!(btnToggleAll.disabled && false);

    saveUiState();

    try {
      if (mode === "split" && $("instruction")) $("instruction").focus();
      if (mode === "extract" && $("extractSymbols")) $("extractSymbols").focus();
    } catch (e) {}
  }

  /* 折りたたみ時の縦サイズ上限（= 先頭何行まで見せるか） */
  const PREVIEW_HEAD_MAX_LINES = 18;

  /* 折りたたみ時の文字数上限（行数で切った後の保険） */
  const PREVIEW_HEAD_MAX_CHARS = 1200;

  function renderPartJumpButtons() {
    const box = $("partJump");
    if (!box) return;

    box.innerHTML = "";

    if (!result || !result.parts || result.parts.length === 0) {
      return;
    }

    for (let i = 0; i < result.parts.length; i++) {
      const p = result.parts[i];

      const btn = document.createElement("button");
      btn.className = "partJumpBtn" + (i === currentIndex ? " primary" : "");
      btn.textContent = String(p.index); /* 1..N の番号だけ */

      btn.onclick = () => {
        currentIndex = i;
        renderCurrent();
        saveUiState();
        setStatus("表示: part_" + String(p.index).padStart(2, "0"));
      };

      box.appendChild(btn);
    }
  }

  function buildPreviewText(fullText) {
    const s = String(fullText || "");
    if (previewAllOn) return s;

    const lines = s.split("\n");
    const headLines = lines.slice(0, PREVIEW_HEAD_MAX_LINES).join("\n");

    let out = headLines;
    if (out.length > PREVIEW_HEAD_MAX_CHARS) {
      out = out.slice(0, PREVIEW_HEAD_MAX_CHARS);
    }

    const isTruncatedByLines = lines.length > PREVIEW_HEAD_MAX_LINES;
    const isTruncatedByChars = headLines.length > PREVIEW_HEAD_MAX_CHARS;

    if (isTruncatedByLines || isTruncatedByChars || out.length < s.length) {
      out += "\n\n…（折りたたみ中：ALL を ON にすると全文表示）";
    }

    return out;
  }

  const HIST_PREVIEW_MAX_LINES = 10;

  function getHistoryMaxCharsByWidth(preEl) {
    /* 幅に応じて省略量を変える（狭いほど短く） */
    try {
      if (!preEl) return 900;

      const rect = preEl.getBoundingClientRect();
      const w = Math.max(0, rect.width);

      /* 履歴preは monospace 11px。だいたい 1文字=7px前後で概算 */
      const approxCharPx = 7;
      const charsPerLine = Math.max(12, Math.floor(w / approxCharPx));

      /* 行数上限×1行文字数に少しバッファ（改行やヘッダ分） */
      const maxChars = (HIST_PREVIEW_MAX_LINES * charsPerLine) + 120;

      /* 極端に大きくしない（広い画面でもダラダラ全文にならない） */
      return Math.min(Math.max(220, maxChars), 2200);
    } catch (e) {
      return 900;
    }
  }

  function buildHistoryPreviewText(fullText, preEl) {
    const s = String(fullText || "");
    const lines = s.split("\n");
    const headLines = lines.slice(0, HIST_PREVIEW_MAX_LINES).join("\n");

    const maxChars = getHistoryMaxCharsByWidth(preEl);

    let out = headLines;
    if (out.length > maxChars) {
      out = out.slice(0, maxChars);
    }

    const isTruncatedByLines = lines.length > HIST_PREVIEW_MAX_LINES;
    const isTruncatedByChars = headLines.length > maxChars;

    if (isTruncatedByLines || isTruncatedByChars || out.length < s.length) {
      out += "\n\n…（省略：このRUNの指示は全文ではありません）";
    }

    return out;
  }

  function updateToggleAllButton() {
    const btn = $("toggleAll");
    if (!btn) return;

    const enabled = !!(result && result.parts && result.parts.length > 0);
    btn.disabled = !enabled;

    if (!enabled) {
      btn.textContent = "ALL: OFF";
      return;
    }

    btn.textContent = previewAllOn ? "ALL: ON" : "ALL: OFF";
  }

  let lastSyntaxCheckOk = null;
  let lastSyntaxCheckMessage = "";

  async function runSyntaxCheckForFile(file) {
    if (!file) return;

    lastSyntaxCheckOk = null;
    lastSyntaxCheckMessage = "";
    setStatus("構文チェック中...");

    let text = "";
    try {
      text = await file.text();
    } catch (e) {
      lastSyntaxCheckOk = false;
      lastSyntaxCheckMessage = "ファイル読み取り失敗: " + String(e);
      setStatus(lastSyntaxCheckMessage);
      return;
    }

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ filename: file.name, content: text })
      });

      if (!res.ok) {
        lastSyntaxCheckOk = false;
        lastSyntaxCheckMessage = "構文チェックAPI失敗: HTTP " + String(res.status);
        setStatus(lastSyntaxCheckMessage);
        return;
      }

      const data = await res.json();
      const ok = !!(data && data.ok);
      const err = String((data && data.error) || "").trim();

      lastSyntaxCheckOk = ok;
      lastSyntaxCheckMessage = ok ? "OK" : (err || "構文エラー");

      if (ok) {
        setStatus("構文チェックOK: " + String(file.name || ""));
      } else {
        setStatus("構文チェックNG: " + String(file.name || "") + " / " + lastSyntaxCheckMessage);
      }
    } catch (e) {
      lastSyntaxCheckOk = false;
      lastSyntaxCheckMessage = "構文チェック例外: " + String(e);
      setStatus(lastSyntaxCheckMessage);
    }
  }

  function setHistRoot(msg) {
    const el = $("histRoot");
    if (!el) return;
    el.textContent = String(msg || "");
  }

  async function fetchInstructionHistoryFromServer() {
    try {
      const res = await fetch("/api/instructions", { method: "GET" });
      if (!res.ok) {
        return { outroot: "", total_dirs: 0, items: [], error: "HTTP " + String(res.status) };
      }
      const data = await res.json();

      const outroot = String((data && data.outroot) || "");
      const total_dirs = Number((data && data.total_dirs) || 0);
      const items = (data && Array.isArray(data.items)) ? data.items : [];

      return { outroot, total_dirs, items, error: "" };
    } catch (e) {
      return { outroot: "", total_dirs: 0, items: [], error: String(e) };
    }
  }

  async function renderInstructionHistory() {
    const box = $("instructionHistory");
    if (!box) return;

    box.innerHTML = "";
    setHistStatus("読み込み中...");

    const data = await fetchInstructionHistoryFromServer();

    if (data.outroot) {
      setHistRoot("参照先: " + data.outroot + "（dirs: " + String(data.total_dirs) + "）");
    } else {
      setHistRoot("参照先: （未取得）");
    }

    if (data.error) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "（読み込み失敗）: " + data.error;
      box.appendChild(div);
      setHistStatus("");
      return;
    }

    const items = data.items;

    if (!items || items.length === 0) {
      const div = document.createElement("div");
      div.className = "muted";
      div.textContent = "（まだ履歴がありません：一度「生成（split）」すると out_protocol_local_tool に保存され、ここに出ます）";
      box.appendChild(div);
      setHistStatus("件数: 0");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const instr = String(it.instruction || "").trim();

      const div = document.createElement("div");
      div.className = "card";

      const header = document.createElement("div");
      header.className = "partHeader";

      const t1 = document.createElement("span");
      t1.className = "pill";
      t1.textContent = "RUN" + String(i + 1).padStart(2, "0");

      const t2 = document.createElement("span");
      t2.className = "pill";
      t2.textContent = String(it.created_at || "");

      const t3 = document.createElement("span");
      t3.className = "pill";
      t3.textContent = String(it.session_id || "");

      const btnUse = document.createElement("button");
      btnUse.textContent = "入力へ反映";
      btnUse.disabled = !instr;
      btnUse.onclick = () => {
        $("instruction").value = instr;
        autosizeInstruction();
        try { $("instruction").focus(); } catch (e) {}
        setHistStatus("入力欄に反映しました: " + String(it.session_id || ""));
      };

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "コピー";
      btnCopy.disabled = !instr;
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(instr);
          flashButton(btnCopy, "ok");
          setHistStatus("コピーしました: " + String(it.session_id || ""));
          const old = btnCopy.textContent;
          btnCopy.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopy.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopy, "ng");
          setHistStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
        }
      };

      const btnDel = document.createElement("button");
      btnDel.textContent = "削除";
      btnDel.disabled = !String(it.output_dir || "");
      btnDel.onclick = async () => {
        const dir = String(it.output_dir || "");
        if (!dir) return;

        const ok = window.confirm("この履歴を削除しますか？\n\n" + dir);
        if (!ok) return;

        btnDel.disabled = true;
        setHistStatus("削除中...: " + String(it.session_id || ""));

        try {
          const res = await fetch("/api/instructions/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ output_dir: dir })
          });

          if (!res.ok) {
            setHistStatus("削除失敗: HTTP " + String(res.status));
            btnDel.disabled = false;
            return;
          }

          const data = await res.json();
          if (data && data.ok) {
            setHistStatus("削除しました: " + String(it.session_id || ""));
            await renderInstructionHistory();
          } else {
            setHistStatus("削除失敗: " + String((data && data.error) || "unknown error"));
            btnDel.disabled = false;
          }
        } catch (e) {
          setHistStatus("削除例外: " + String(e));
          btnDel.disabled = false;
        }
      };

      const btnCopySrc = document.createElement("button");
      btnCopySrc.textContent = "元JSコピー";
      btnCopySrc.disabled = !String(it.output_dir || "") || !String(it.original_saved_copy || "");
      btnCopySrc.onclick = async () => {
        const dir = String(it.output_dir || "");
        if (!dir) return;

        setHistStatus("元JS取得中...: " + String(it.session_id || ""));

        try {
          const url = "/api/instructions/original?output_dir=" + encodeURIComponent(dir);
          const res = await fetch(url, { method: "GET" });

          if (!res.ok) {
            setHistStatus("元JS取得失敗: HTTP " + String(res.status));
            flashButton(btnCopySrc, "ng");
            return;
          }

          const text = await res.text();
          await navigator.clipboard.writeText(text);

          flashButton(btnCopySrc, "ok");
          setHistStatus("元JSをコピーしました: " + String(it.session_id || ""));

          const old = btnCopySrc.textContent;
          btnCopySrc.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopySrc.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopySrc, "ng");
          setHistStatus("元JSコピー失敗（権限/HTTP制約等）: " + String(e));
        }
      };

      header.appendChild(t1);
      header.appendChild(t2);
      header.appendChild(t3);
      header.appendChild(btnUse);
      header.appendChild(btnCopy);
      header.appendChild(btnDel);
      header.appendChild(btnCopySrc);

      // 追加した処理: 「元JSコピー」ボタンの右に、対象JSのファイル名を表示する
      const jsNamePill = document.createElement("span");
      jsNamePill.className = "pill";
      (function(){
        const targetFile = String(it.target_file || "").trim();
        const savedCopy  = String(it.original_saved_copy || "").trim();

        let name = targetFile;
        if (!name && savedCopy) {
          const parts = savedCopy.split(/[\\/]/);
          name = parts.length ? String(parts[parts.length - 1] || "").trim() : "";
        }

        jsNamePill.textContent = name ? ("JS: " + name) : "JS: (unknown)";
      })();
      header.appendChild(jsNamePill);

      const pre = document.createElement("pre");
      if (instr) {
        pre.dataset.fullInstruction = instr;
        pre.textContent = buildHistoryPreviewText(instr, pre);
      } else {
        pre.textContent = "（この run の manifest.json に instruction がありません）";
      }

      div.appendChild(header);
      div.appendChild(pre);
      box.appendChild(div);
    }

    setHistStatus("件数: " + items.length);
  }

  function setStatus(msg) {
    const el = $("status");
    if (!el) return;

    /* 表示内容を文字列化して扱う（null/undefined 対策） */
    const s = String(msg || "");

    /* 空メッセージなら、status 自体を非表示にする（未選択時など） */
    if (s.trim() === "") {
      el.textContent = "";
      el.style.display = "none";
      return;
    }

    /* メッセージがある時だけ表示する */
    el.textContent = s;
    el.style.display = "";
  }

  function setHistStatus(msg) {
    const el = $("histStatus");
    if (!el) return;
    el.textContent = msg;
  }

  function flashButton(btn, kind) {
    if (!btn) return;
    const cls = (kind === "ng") ? "flash-ng" : "flash-ok";
    btn.classList.add(cls);
    window.setTimeout(() => btn.classList.remove(cls), 220);
  }

  function flashPartSwitchCue(options) {
    const title = $("currentPartTitle");
    const pre = $("preview");

    const opt = (options && typeof options === "object") ? options : {};
    const doScroll = (opt.scroll === false) ? false : true;

    if (title) {
      title.classList.add("flash-part-switch");
      window.setTimeout(() => title.classList.remove("flash-part-switch"), 560);
    }
    if (pre) {
      pre.classList.add("flash-part-switch");
      window.setTimeout(() => pre.classList.remove("flash-part-switch"), 560);
    }

    /* 追加した処理: スクロール（ページ内ジャンプ）を抑止できるようにする */
    if (!doScroll) return;

    /* 追加した処理: 切替直後に「今どこを見れば良いか」を明確にするため、プレビューへスクロールする */
    try {
      if (pre && typeof pre.scrollIntoView === "function") {
        pre.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function goNextPartWithCue(originLabel, options) {
    if (!result || !result.parts || result.parts.length === 0) return false;

    if (currentIndex < result.parts.length - 1) {
      const prev = result.parts[currentIndex];
      currentIndex += 1;
      const next = result.parts[currentIndex];

      /* 追加した処理: 表示を切り替える（次のパート） */
      renderCurrent();
      saveUiState();

      /* 追加した処理: 切り替わったことを水色フラッシュで明示する（必要ならスクロール抑止） */
      flashPartSwitchCue(options);

      /* 追加した処理: 状態表示に「コピー→次へ」等の由来を含め、何が起きたか分かるようにする */
      const origin = String(originLabel || "操作");
      setStatus(origin + "：表示を切替（" + prev.part_id + " → " + next.part_id + "）");

      return true;
    }

    return false;
  }

  async function copyCurrent() {
    if (!result) return;
    const p = result.parts[currentIndex];
    const btn = $("copyCurrent");
    try {
      await navigator.clipboard.writeText(p.payload);
      flashButton(btn, "ok");

      /* 追加した処理: コピー成功後、次のパートへ自動で切り替える（ただしスクロールはしない） */
      const moved = goNextPartWithCue("コピー→次のパートへ", { scroll: false });

      if (!moved) {
        setStatus("コピーしました（最後のパート）: " + p.part_id);
      }

      const old = btn.textContent;
      btn.textContent = "Copied ✓";
      window.setTimeout(() => (btn.textContent = old), 650);
    } catch (e) {
      flashButton(btn, "ng");
      setStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
    }
  }

  async function copyNext() {
    if (!result) return;
    const btn = $("copyNext");

    if (currentIndex < result.parts.length - 1) {
      flashButton(btn, "ok");

      /* 追加した処理: 「次のパートを表示」でも同じ強い明示（フラッシュ＋ステータス）を出す */
      goNextPartWithCue("次のパートを表示");

      const old = btn.textContent;
      btn.textContent = "表示 ✓";
      window.setTimeout(() => (btn.textContent = old), 650);
    } else {
      flashButton(btn, "ng");
      setStatus("これが最後のパートです: " + result.parts[currentIndex].part_id);
    }
  }

  function renderCurrent() {
    if (!result || !result.parts || result.parts.length === 0) {
      $("preview").textContent = "(まだ生成していません)";
      if ($("currentPartTitle")) {
        const root = $("currentPartTitle");
        const label = root.querySelector(".currentPartLabel");
        const meta  = root.querySelector(".currentPartMeta");

        if (label && meta) {
          /* span構造を維持したまま「未生成」表示に戻す */
          label.textContent = "現在のパート";
          meta.textContent  = "　Part: - / -　(SessionID: -)";
        } else {
          /* 旧DOM（spanが無い）対策：最小限の復元（フォールバックではなくDOM整形） */
          root.innerHTML =
            '<span class="currentPartLabel">現在のパート</span>' +
            '<span class="currentPartMeta">　Part: - / -　(SessionID: -)</span>';
        }
      }
      $("pidPill").textContent = "PartID: -";
      if ($("sha8Pill")) {
        $("sha8Pill").textContent = "SHA8: -";
      }

      previewAllOn = false;
      updateToggleAllButton();
      return;
    }
    
    const p = result.parts[currentIndex];
    $("preview").textContent = buildPreviewText(p.payload);
    if ($("currentPartTitle")) {
      const root = $("currentPartTitle");
      const label = root.querySelector(".currentPartLabel");
      const meta  = root.querySelector(".currentPartMeta");

      if (label) {
        label.textContent = "現在のパート";
      }
      if (meta) {
        meta.textContent =
          "　Part: " + p.index + " / " + p.total +
          "　(SessionID: " + result.session_id + ")";
      }
    }
    $("pidPill").textContent = "PartID: " + p.part_id;
    if ($("sha8Pill")) {
      const s8 = (p && typeof p.part_sha8 === "string" && p.part_sha8) ? p.part_sha8 : "-";
      $("sha8Pill").textContent = "SHA8: " + s8;
    }
    $("copyNext").disabled = false;
    $("copyCurrent").disabled = false;

    updateToggleAllButton();
    renderPartJumpButtons(); /* 右端のパート番号ボタンを更新 */
  }

  function renderList() {
    const box = $("partsList");
    box.innerHTML = "";
    if (!result || !result.parts) return;

    for (let i = 0; i < result.parts.length; i++) {
      const p = result.parts[i];
      const div = document.createElement("div");
      div.className = "card";
      const btnGo = document.createElement("button");
      btnGo.textContent = "表示";
      btnGo.onclick = () => {
        currentIndex = i;
        renderCurrent();
        saveUiState();
        setStatus("表示: part_" + String(p.index).padStart(2, "0"));
      };

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "コピー";
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(p.payload);
          flashButton(btnCopy, "ok");
          setStatus("コピーしました: " + p.part_id);
          const old = btnCopy.textContent;
          btnCopy.textContent = "Copied ✓";
          window.setTimeout(() => (btnCopy.textContent = old), 650);
        } catch (e) {
          flashButton(btnCopy, "ng");
          setStatus("コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
        }
      };

      const header = document.createElement("div");
      header.className = "partHeader";
      const t1 = document.createElement("span");
      t1.className = "pill";
      t1.textContent = "part_" + String(p.index).padStart(2, "0") + ".txt";
      const t2 = document.createElement("span");
      t2.className = "pill";
      t2.textContent = p.part_id;

      const t3 = document.createElement("span");
      t3.className = "pill";
      const s8 = (p && typeof p.part_sha8 === "string" && p.part_sha8) ? p.part_sha8 : "-";
      t3.textContent = "SHA8:" + s8;

      header.appendChild(t1);
      header.appendChild(t2);
      header.appendChild(t3);
      header.appendChild(btnGo);
      header.appendChild(btnCopy);

      div.appendChild(header);
      box.appendChild(div);
    }
  }

  function resetGeneratedOnly() {
    /* 生成結果だけをリセット（instruction は触らない） */
    result = null;
    currentIndex = 0;
    previewAllOn = false;

    $("partsList").innerHTML = "";
    $("preview").textContent = "(まだ生成していません)";
    if ($("idxPill")) {
      $("idxPill").textContent = "Part: -";
    }
    $("pidPill").textContent = "PartID: -";
    if ($("currentSessionInline")) {
      $("currentSessionInline").textContent = "(SessionID: -)";
    }

    $("copyNext").disabled = true;
    $("copyCurrent").disabled = true;

    if ($("resetGen")) {
      $("resetGen").disabled = true;
    }

    saveUiState();
    renderPartJumpButtons(); /* 右端のパート番号ボタンを消す/更新 */
    setHistRoot("参照先: （未取得）");
    setStatus("生成結果をリセットしました（指示は保持）");
  }

  function resetExtractOnly() {
    /* 抽出結果だけをリセット（symbols/needles入力は触らない） */
    lastExtractText = "";

    const ta = $("extractPreview");
    if (ta) ta.value = "";

    const btnCopyExtract = $("copyExtract");
    if (btnCopyExtract) btnCopyExtract.disabled = true;

    const btnResetExtract = $("resetExtract");
    if (btnResetExtract) btnResetExtract.disabled = true;

    saveUiState();
    setStatus("抽出結果をリセットしました（入力は保持）");
  }

  async function doSplit() {
    const f = $("file").files[0];
    if (!f) {
      setStatus("JSファイルを選んでください");
      return;
    }

    if (lastSyntaxCheckOk === false) {
      setStatus("構文チェックNGのため生成を中止します: " + String(lastSyntaxCheckMessage || ""));
      return;
    }

    const instr = String($("instruction").value || "").trim();
    if (!instr) {
      /* 生成時に instruction が空なら止める（空EXEC_TASK防止） */
      setStatus("指示（--instruction）が空です。必ず記入してください。");
      try { $("instruction").focus(); } catch (e) {}
      return;
    }

    const text = await f.text();
    const payload = {
      filename: f.name,
      content: text,
      prefix: $("prefix").value || "CSCSJS",
      lang: $("lang").value || "javascript",
      maxchars: Number($("maxchars").value || 60000),
      maxlines: Number($("maxlines").value || 1200),
      maxlogs: Number($("maxlogs").value || 50),
      split_mode: ($("splitMode") && $("splitMode").value) ? String($("splitMode").value) : "C",
      iife_grace_ratio: 0.30,
      instruction: instr
    };

    setStatus("分割中...");
    $("run").disabled = true;
    $("copyNext").disabled = true;
    $("copyCurrent").disabled = true;

    const res = await fetch("/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });

    $("run").disabled = false;

    if (!res.ok) {
      const t = await res.text();
      setStatus("エラー: " + t);
      return;
    }

    result = await res.json();
    currentIndex = 0;
    restoreUiStatePostResult();
    renderList();
    renderCurrent();
    renderInstructionHistory();
    autosizeInstruction();
    saveUiState();

    if ($("resetGen")) {
      $("resetGen").disabled = false;
    }

    setStatus("生成完了: " + result.session_id + " / parts=" + result.parts.length);
  }

  $("run").onclick = doSplit;

  if ($("resetExtract")) {
    $("resetExtract").onclick = () => resetExtractOnly();
  }
  
  if ($("modeSplitBtn")) {
    $("modeSplitBtn").onclick = () => applyUIMode("split");
  }
  if ($("modeExtractBtn")) {
    $("modeExtractBtn").onclick = () => applyUIMode("extract");
  }

  if ($("extractSymbols")) {
    $("extractSymbols").addEventListener("input", () => saveUiState());
  }
  if ($("extractNeedles")) {
    $("extractNeedles").addEventListener("input", () => saveUiState());
  }
  /* 追加した処理: PURPOSE / DEPENDS も入力変更で即保存 */
  if ($("extractPurpose")) {
    $("extractPurpose").addEventListener("input", () => saveUiState());
  }
  if ($("extractDepends")) {
    $("extractDepends").addEventListener("input", () => saveUiState());
  }
  if ($("extractContextLines")) {
    $("extractContextLines").addEventListener("input", () => saveUiState());
  }
  if ($("extractMaxMatches")) {
    $("extractMaxMatches").addEventListener("input", () => saveUiState());
  }

  async function doExtract() {
    const f = $("file").files[0];
    if (!f) {
      setStatus("JSファイルを選んでください");
      return;
    }

    if (lastSyntaxCheckOk === false) {
      setStatus("構文チェックNGのため抽出を中止します: " + String(lastSyntaxCheckMessage || ""));
      return;
    }

    const sym = String(($("extractSymbols") && $("extractSymbols").value) || "").trim();
    const ndl = String(($("extractNeedles") && $("extractNeedles").value) || "").trim();

    const ctxRaw = String(($("extractContextLines") && $("extractContextLines").value) || "25").trim();
    const mxmRaw = String(($("extractMaxMatches") && $("extractMaxMatches").value) || "50").trim();

    const symbols = sym ? sym.split(",").map(s => String(s).trim()).filter(s => s) : [];
    const needles = ndl ? ndl.split(",").map(s => String(s)).filter(s => s !== "") : [];

    const context_lines = ctxRaw ? Number(ctxRaw) : 25;
    const max_matches = mxmRaw ? Number(mxmRaw) : 50;

    const text = await f.text();

    const payload = {
      filename: f.name,
      content: text,
      symbols: symbols,
      needles: needles,
      context_lines: context_lines,
      max_matches: max_matches
    };

    setStatus("抽出中...");
    $("run").disabled = true;
    if ($("runExtract")) $("runExtract").disabled = true;

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });

      $("run").disabled = false;
      if ($("runExtract")) $("runExtract").disabled = false;

      if (!res.ok) {
        const t = await res.text();
        setStatus("抽出エラー: " + t);
        return;
      }

      const data = await res.json();
      if (!data || !data.ok) {
        setStatus("抽出失敗: " + String((data && data.error) || "unknown"));
        return;
      }

      /* 追加した処理: 抽出成功時点で「コピー」と「リセット」を有効化する */
      if ($("copyExtract")) $("copyExtract").disabled = false;
      if ($("resetExtract")) $("resetExtract").disabled = false;

      /* 追加した処理: コードブロック先頭の空行だけを除去し、```javascript の直後が必ず実コード行になるようにする */
      function trimLeadingBlankLinesForFence(codeText) {
        const s = String(codeText || "");
        return s.replace(/^\n+/, "");
      }

      const outLines = [];
      outLines.push("<<<EXTRACT_BEGIN>>>");
      outLines.push("FILE: " + String(data.filename || ""));
      outLines.push("SYMBOLS: " + String((data.symbols || []).join(", ")));
      outLines.push("NEEDLES: " + String((data.needles || []).join(", ")));

      /* 追加した処理: “抽出の目的”を1行で明示（LLMの判断がブレにくくなる） */
      outLines.push("PURPOSE: " + String((($("extractPurpose") && $("extractPurpose").value) || "")).trim());

      /* 追加した処理: 依存の“存在だけ”をメタで列挙（中身不要 / 推測を減らす） */
      outLines.push("DEPENDS: " + String((($("extractDepends") && $("extractDepends").value) || "")).trim());

      outLines.push("");

      /* 追加した処理: 出力テキストを後処理で「FOUND:true（コピー対象）」と
         「FOUND:false（コピー対象外ログ）」に振り分ける（data構造に依存しない） */
      function splitExtractTextByFoundFlags(fullText) {
        const s = String(fullText || "");
        const lines = s.split("\n");

        const keep = [];      // textarea（コピー対象）
        const nf = [];        // textarea外ログ（コピー対象外）

        // ブロック単位： "【...】" で開始する塊をひとまず作る
        let cur = [];
        function flush() {
          if (!cur.length) return;

          const blockText = cur.join("\n");
          const isFoundFalse = /\nFOUND:\s*false\b/.test("\n" + blockText);
          const isFoundTrue  = /\nFOUND:\s*true\b/.test("\n" + blockText);

          if (isFoundFalse && !isFoundTrue) {
            nf.push(blockText);
          } else {
            // FOUND:true（または FOUND 行が無いメタ部）は textarea 側へ残す
            keep.push(blockText);
          }
          cur = [];
        }

        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];

          // "【" から始まる行をブロック境界として扱う（今の出力形式と一致）
          if (ln.startsWith("【") && cur.length > 0) {
            flush();
          }
          cur.push(ln);
        }
        flush();

        return {
          keepText: keep.join("\n"),
          notFoundText: nf.join("\n")
        };
      }

      // outLines の組み立てが全部終わったあとに呼ぶ想定
      const __fullOutText = outLines.join("\n");
      const __split = splitExtractTextByFoundFlags(__fullOutText);

      // textarea（コピー対象）は FOUND:true だけ（+ 先頭メタ部は維持）
      lastExtractText = __split.keepText;
      if ($("extractPreview")) {
        $("extractPreview").value = __split.keepText;
      }

      // FOUND:false は textarea 外に“小ログ”として表示（コピー対象外）
      const nfEl = $("extractNotFoundLog");
      if (nfEl) {
        const t = String(__split.notFoundText || "").trim();
        if (t) {
          nfEl.textContent = "FOUND: false（コピー対象外ログ）\n" + t;
        } else {
          nfEl.textContent = "";
        }
      }

      const blocks = data.blocks || [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] || {};
        if (b.kind === "function_whole") {
          outLines.push("【FUNCTION_WHOLE】 " + String(b.name || ""));
          outLines.push("FOUND: " + String(!!b.found));
          outLines.push("HEADER: " + String(b.header || ""));
          outLines.push("SHA256: " + String(b.sha256 || ""));
          outLines.push("```javascript");
          outLines.push(trimLeadingBlankLinesForFence(b.text));
          outLines.push("```");
          outLines.push("");
          continue;
        }

        if (b.kind === "context") {
          outLines.push("【CONTEXT】 " + String(b.needle || ""));
          outLines.push("HITS: " + String(b.hit_count || 0));
          outLines.push("LINES: ±" + String(b.context_lines || 0));
          outLines.push("MAX_MATCHES: " + String(b.max_matches || 0));
          outLines.push("");

          const items = b.items || [];
          for (let k = 0; k < items.length; k++) {
            const it = items[k] || {};
            outLines.push("HEADER: " + String(it.header || ""));
            outLines.push("SHA256: " + String(it.sha256 || ""));
            outLines.push("```javascript");
            outLines.push(trimLeadingBlankLinesForFence(it.text));
            outLines.push("```");
            outLines.push("");
          }
        }
      }

      outLines.push("<<<EXTRACT_END>>>");

      lastExtractText = outLines.join("\n");

      /* 追加した処理: 抽出結果は専用textareaへ表示（splitの「現在のパート」カードは触らない） */
      const ex = $("extractPreview");
      if (ex) {
        ex.value = lastExtractText;
        try { ex.scrollTop = 0; } catch (e) {}
      }

      const btnCopyExtract = $("copyExtract");
      if (btnCopyExtract) {
        btnCopyExtract.disabled = !lastExtractText;
      }

      setStatus("抽出完了（抽出結果カードに出しました）。「抽出結果をコピー」でそのまま貼れます。");
    } catch (e) {
      $("run").disabled = false;
      if ($("runExtract")) $("runExtract").disabled = false;
      setStatus("抽出例外: " + String(e));
    }
  }

  if ($("runExtract")) {
    $("runExtract").onclick = doExtract;
  }

  $("copyCurrent").onclick = copyCurrent;
  $("copyNext").onclick = copyNext;

  async function copyExtract() {
    const btn = $("copyExtract");
    try {
      const text = String(lastExtractText || "");
      if (!text.trim()) {
        flashButton(btn, "ng");
        setStatus("抽出結果が空です（先に「抽出（extract）」を実行してください）");
        return;
      }

      await navigator.clipboard.writeText(text);
      flashButton(btn, "ok");

      const old = btn.textContent;
      btn.textContent = "Copied ✓";
      window.setTimeout(() => (btn.textContent = old), 650);

      setStatus("抽出結果をコピーしました（<<<EXTRACT_BEGIN>>> から全部）");
    } catch (e) {
      flashButton(btn, "ng");
      setStatus("抽出結果コピー失敗（ブラウザ権限/HTTPS制約の可能性）: " + String(e));
    }
  }

  if ($("copyExtract")) {
    $("copyExtract").onclick = copyExtract;
  }

  if ($("instruction")) {
    $("instruction").addEventListener("input", () => {
      autosizeInstruction();
      saveUiState();
    });
  }

  if ($("toggleAll")) {
    $("toggleAll").onclick = () => {
      previewAllOn = !previewAllOn;
      updateToggleAllButton();
      renderCurrent();
      saveUiState();
    };
  }
  
  if ($("prefix")) {
    $("prefix").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("lang")) {
    $("lang").addEventListener("change", () => {
      saveUiState();
    });
  }

  if ($("maxchars")) {
    $("maxchars").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("maxlines")) {
    $("maxlines").addEventListener("input", () => {
      saveUiState();
    });
  }

  if ($("maxlogs")) {
    $("maxlogs").addEventListener("input", () => {
      saveUiState();
    });
  }

  (function(){
    const hidden = $("splitMode");
    const radios = document.querySelectorAll('input[name="splitModeRadio"]');

    if (radios && radios.length > 0) {
      for (let i = 0; i < radios.length; i++) {
        const r = radios[i];
        r.addEventListener("change", () => {
          if (!r.checked) return;

          const v = String(r.value || "C");
          if (hidden) {
            hidden.value = v;
          }
          saveUiState();
        });
      }
    }
  })();

  if ($("file")) {
    $("file").addEventListener("change", async () => {
      const f = $("file").files && $("file").files[0] ? $("file").files[0] : null;
      if (!f) return;
      runSyntaxCheckForFile(f);
    });
  }

  if ($("resetGen")) {
    $("resetGen").onclick = resetGeneratedOnly;
    $("resetGen").disabled = true;
  }

  if ($("histClear")) {
    $("histClear").disabled = true;
  }

  restoreUiState();
  applyUIMode(window.__uiMode || "split");

  (function(){
    const hidden = $("splitMode");
    const v = String(hidden && hidden.value ? hidden.value : "C");
    const radios = document.querySelectorAll('input[name="splitModeRadio"]');
    for (let i = 0; i < radios.length; i++) {
      const r = radios[i];
      const rv = String(r && r.value ? r.value : "");
      r.checked = (rv === v);
    }
  })();

  autosizeInstruction();
  updateToggleAllButton();
  renderCurrent();
  renderInstructionHistory();
  saveUiState();

  /* 初期表示では status を出さない（ファイル未選択時の非表示） */
  setStatus("");
  
  window.addEventListener("resize", () => {
    try {
      const box = $("instructionHistory");
      if (!box) return;

      const cards = box.querySelectorAll(".card");
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const pre = c.querySelector("pre");
        if (!pre) continue;

        /* 元の全文 instruction は pre の dataset に保持しておく */
        const raw = pre.dataset && typeof pre.dataset.fullInstruction === "string"
          ? pre.dataset.fullInstruction
          : null;

        if (raw !== null) {
          pre.textContent = buildHistoryPreviewText(raw, pre);
        }
      }
    } catch (e) {}
  });  
  
</script>
</body>
</html>
"""


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
) -> Tuple[str, Path, List[SplitPart], List[str]]:
    session_id = make_session_id(prefix, content)
    chunks = split_by_limits(
        content,
        maxchars,
        maxlines,
        split_mode=split_mode,
        iife_grace_ratio=iife_grace_ratio,
    )
    total = len(chunks)

    out_dir = outroot / f"{session_id}_{now_tag()}"
    parts_dir = out_dir / "parts"
    safe_mkdir(parts_dir)

    parts: List[SplitPart] = []
    for idx, (st, ed, ch) in enumerate(chunks, start=1):
        part_id = build_part_id(session_id, idx, total)
        lines = ch.splitlines()
        first_line = lines[0] if lines else ""
        last_line = lines[-1] if lines else ""

        parts.append(SplitPart(
            index=idx,
            total=total,
            part_id=part_id,
            text=ch,
            start_offset=st,
            end_offset=ed,

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
        overview_text=instruction,
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
            exec_task_text=instruction,
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
        instruction=instruction,
        original_saved_relpath=original_saved_rel,
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
                    items.append({
                        "output_dir": str(d),
                        "session_id": str(data.get("session_id") or ""),
                        "created_at": str(data.get("created_at") or ""),
                        "target_file": str(inp.get("filename") or ""),
                        "original_sha256": str(inp.get("sha256") or ""),
                        "original_saved_copy": str(inp.get("saved_copy") or ""),
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
