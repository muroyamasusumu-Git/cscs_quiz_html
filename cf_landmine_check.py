#!/usr/bin/env python3
# cf_landmine_check.py
# -*- coding: utf-8 -*-
# cd /Users/muroyamasusumu/Documents/cscs_video_quiz/quiz_html/landmine_check/
# python3 cf_landmine_check.py

"""
cf_landmine_check.py

目的:
  Cloudflare Workers / KV 周りの「知らないと一生ループしやすい地雷」を、
  コードベースから機械的に検出するための静的チェッカー。

方式（重要）:
  - AST解析ではなく「正規表現（regex）による全文スキャン」。
  - そのため、"実コード" だけでなく「コメント」「ログ文字列」など、
    ファイル内に含まれる文字列も一致すれば検出される。
    → 見落としゼロを優先した設計（誤検出は許容し、人間が最終判断）。

デフォルト動作:
  - 引数なしで実行した場合は「この .py と同じフォルダ」を走査対象にする。
    → 実行カレントディレクトリに依存しない。
  - 第一引数にディレクトリ/ファイルを渡した場合、そのパスを走査対象にする。

出力と終了コード:
  - 検出が無い: "[OK]" を表示し exit code 0
  - 検出がある: "[DETECTED]" を表示し exit code 2（CI等でブロック可能）

運用ルール（重要）:
  - Cloudflare Workers / KV 周りの仕様・制限・推奨は更新され得る。
  - 本ツールは「知らないまま無限ループ」や「誤解による設計ミス」を減らすため、
    DEFAULT_RULES を定期的に見直し、必要があれば新しい地雷パターンを追加する。
  - 追加候補は、実際の障害・デバッグログ・公式ドキュメント更新・運用で得た知見を優先する。

ルール拡張:
  - 第二引数に rules.json を渡すと DEFAULT_RULES の代わりにそれを使用する。
"""

import os
import re
import sys
import json
from dataclasses import dataclass
from typing import List, Dict, Pattern, Tuple, Optional

# ============================================================
# ルールセット（DEFAULT_RULES）
# ------------------------------------------------------------
# - 本ツールは「正規表現で全文スキャン」を基本とするが、
#   誤検出を減らすために、JS/TS はコメント/文字列を簡易除去してから判定する。
# - HTML は <script>...</script> ブロック内のみを抽出して判定する（HTML本文は見ない）。
# ============================================================

INCLUDE_CODE_EXT = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html"]

DEFAULT_RULES = [
  {
    "id": "KV_CACHE_TTL_ZERO",
    "title": "Workers KV: cacheTtl: 0 は不正（minimum 60）",
    "severity": "HIGH",
    "why": "KV の cacheTtl は 60秒以上が必須。0 を渡すと例外→catch→再試行で無限ループの原因になる。",
    "include_ext": INCLUDE_CODE_EXT,
    "pattern": r"\bcacheTtl\s*:\s*0\b",
    "note": "※ fetch の cf.cacheTtl は 0 OK。KV get/put の options に入っていないか周辺コードで判定すること。"
  },
  {
    "id": "KV_CACHE_TTL_LT60_LITERAL",
    "title": "Workers KV: cacheTtl が 60未満のリテラル",
    "severity": "HIGH",
    "why": "KV cacheTtl の最小は 60秒。59以下は本番で例外化しやすい。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bcacheTtl\s*:\s*([1-5]?\d)\b",
    "note": "数値が変数の場合は別ルールでカバー（normalize関数導入推奨）。"
  },
  {
    "id": "KV_EXPIRATION_TTL_LT60",
    "title": "Workers KV: expirationTtl が 60未満のリテラル",
    "severity": "HIGH",
    "why": "KV の expirationTtl は 60秒未満が非サポート。『すぐ消す』用途で踏みやすい。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bexpirationTtl\s*:\s*([1-5]?\d)\b",
    "note": ""
  },
  {
    "id": "FETCH_CF_CACHETTL_ON_NON_GET",
    "title": "fetch cf.cacheTtl は GET/HEAD のみに適用（他メソッドで指定しても期待通りにならない）",
    "severity": "MED",
    "why": "cf.cacheTtl は GET/HEAD のみに適用される仕様。POST等で指定しても効かない/誤解が起きる。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bfetch\s*\([\s\S]*?\{\s*cf\s*:\s*\{\s*[\s\S]*?\bcacheTtl\b",
    "note": "このルールは『存在検出』。実際にGET/HEADかは手動確認かAST解析で精度を上げる。"
  },
  {
    "id": "SUBREQUEST_HEAVY_HINT",
    "title": "subrequest上限を踏みやすい構造（ループ内 fetch / Cache API）",
    "severity": "MED",
    "why": "subrequestはfetch/redirect/Cache APIもカウント。ループや再試行で上限超過しやすい。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\b(for\s*\(|while\s*\(|\.map\s*\(|\.forEach\s*\()\s*[\s\S]{0,400}\bfetch\s*\(",
    "note": "誤検出もあるが、怪しい場所の棚卸しには強い。"
  },
  {
    "id": "KV_EXPIRATION_TTL_ZERO",
    "title": "Workers KV: expirationTtl: 0 は不正（minimum 60）",
    "severity": "HIGH",
    "why": "KV の expirationTtl は 60秒以上が必須。0 を渡すと例外や想定外の挙動の原因になる。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bexpirationTtl\s*:\s*0\b",
    "note": "KV put オプションの expirationTtl は minimum 60。"
  },
  {
    "id": "KV_PUT_THEN_GET_ASSERT_HINT",
    "title": "Workers KV: put直後にgetして存在を断定するパターン（同一key検証の匂い）",
    "severity": "MED",
    "why": "KV はキャッシュ/最終整合の都合で、書き込み直後に別ロケーションから読むと見えないことがある。直後getの失敗を『保存失敗』と誤判定すると再試行ループになりやすい。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\.put\s*\(\s*([A-Za-z_$][\w$]*|[\"'][^\"']+[\"'])\s*,[\s\S]{0,500}\)\s*;[\s\S]{0,500}\.get\s*\(\s*\1\s*(?:,|\))",
    "note": "誤検出を減らすため、put/get の第1引数（key）が同一（同一変数名または同一文字列）っぽい場合のみ検出する。"
  },
  {
    "id": "CACHE_API_PUT_USAGE",
    "title": "Cache API: caches.default.put の使用箇所（環境/ティアードキャッシュ注意）",
    "severity": "LOW",
    "why": "Cache API の put は環境やキャッシュ方式（tiered caching 等）との相性があり、意図通り動かないケースがある。用途と環境前提の確認が必要。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bcaches\.default\.put\s*\(",
    "note": "Cache API の使い方/制約は docs を前提に確認すること。"
  },
  {
    "id": "FETCH_REDIRECT_FOLLOW_HINT",
    "title": "fetch: redirect: \"follow\" の使用（redirect chain が subrequest 上限に加算される）",
    "severity": "MED",
    "why": "redirect chain の各 subrequest が上限にカウントされる。再試行やループと合わさると想定外に上限を踏む。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bredirect\s*:\s*[\"']follow[\"']",
    "note": "subrequest上限はプランで 50/1000。redirect chain も加算される。"
  },
  {
    "id": "KV_GET_ASSERT_FAIL_FAST_HINT",
    "title": "Workers KV: get結果を即『失敗断定』して throw/return/error する匂い（直後検証ループ注意）",
    "severity": "MED",
    "why": "KVの直後getはキャッシュ/最終整合で見えないことがある。そこで fail-fast すると再試行ループの温床になりやすい。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    "pattern": r"\bawait\s+[\s\S]{0,120}\.get\s*\([\s\S]{0,200}\)\s*;[\s\S]{0,200}\b(if\s*\(\s*!\s*\w+|\b==\s*null\b|\b===\s*null\b|\b===\s*undefined\b)[\s\S]{0,200}\b(throw\s+new\s+Error|console\.error|return\s+)",
    "note": "誤検出あり。get直後の『見えない＝保存失敗』断定が無いか周辺確認。"
  }
  
]

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".wrangler", ".next", ".nuxt", ".venv", "venv", "__pycache__"}

@dataclass
class Hit:
  rule_id: str
  severity: str
  file_path: str
  line_no: int
  line: str
  title: str
  why: str
  note: str
  col_no: int
  match: str

def load_rules(path: Optional[str]) -> List[Dict]:
  if not path:
    return DEFAULT_RULES
  with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
  if not isinstance(data, list):
    raise ValueError("Rules JSON must be a list")
  return data

def should_scan_file(file_path: str, include_ext: List[str]) -> bool:
  _, ext = os.path.splitext(file_path)
  return ext.lower() in set([e.lower() for e in include_ext])

def compile_rule(rule: Dict) -> Tuple[Pattern, Dict]:
  pat = rule.get("pattern")
  if not pat:
    raise ValueError(f"Rule missing pattern: {rule}")
  try:
    return re.compile(pat, re.MULTILINE), rule
  except re.error as e:
    raise ValueError(f"Invalid regex in rule {rule.get('id')}: {e}")

HTML_SCRIPT_RX = re.compile(r"<script\b[^>]*>([\s\S]*?)</script>", re.IGNORECASE)

def extract_html_scripts(html_text: str) -> str:
  blocks = []
  for m in HTML_SCRIPT_RX.finditer(html_text):
    blocks.append(m.group(1))
  return "\n\n".join(blocks)

def strip_js_like_comments_and_strings(text: str) -> str:
  """
  JS/TS/JSX/TSX 向けの簡易ストリップ。
  - // 行コメント, /* */ ブロックコメント を除去
  - '...', "...", `...` を除去（テンプレ文字列内の ${...} も概ね潰れる）
  目的は「誤検出の減少」であり、完全なパーサではない。
  """
  out = []
  i = 0
  n = len(text)
  while i < n:
    ch = text[i]

    # line comment //
    if ch == "/" and i + 1 < n and text[i + 1] == "/":
      i += 2
      while i < n and text[i] != "\n":
        i += 1
      out.append("\n")
      i += 1
      continue

    # block comment /* ... */
    if ch == "/" and i + 1 < n and text[i + 1] == "*":
      i += 2
      while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
        i += 1
      i += 2
      out.append(" ")
      continue

    # strings: ', ", `
    if ch in ("'", '"', "`"):
      quote = ch
      out.append(" ")
      i += 1
      while i < n:
        c = text[i]
        if c == "\\":
          i += 2
          continue
        if c == quote:
          i += 1
          break
        if c == "\n" and quote != "`":
          break
        i += 1
      continue

    out.append(ch)
    i += 1

  return "".join(out)

def scan_file(file_path: str, compiled_rules: List[Tuple[Pattern, Dict]]) -> List[Hit]:
  hits: List[Hit] = []
  try:
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
      raw_text = f.read()
  except Exception:
    return hits

  _, ext = os.path.splitext(file_path)
  ext = ext.lower()

  # HTML は <script> の中だけを対象（HTML本文での誤検出を減らす）
  if ext == ".html":
    scan_text = extract_html_scripts(raw_text)
  else:
    # JS/TS はコメント/文字列を簡易除去（ログ文字列・説明コメント由来の誤検出を減らす）
    scan_text = strip_js_like_comments_and_strings(raw_text)

  raw_lines = raw_text.splitlines()
  for (rx, rule) in compiled_rules:
    include_ext = rule.get("include_ext", [])
    if include_ext and not should_scan_file(file_path, include_ext):
      continue

    for m in rx.finditer(scan_text):
      # 位置は scan_text のものなので、raw_text との完全一致は保証できない。
      # ただし行番号の精度を上げるため、raw_text 側での近傍検索を行う。
      needle = m.group(0)
      idx = raw_text.find(needle)
      if idx < 0:
        idx = m.start()
      line_no = raw_text.count("\n", 0, idx) + 1
      line = raw_lines[line_no - 1] if 1 <= line_no <= len(raw_lines) else ""
      col = idx - (raw_text.rfind("\n", 0, idx) + 1)

      hits.append(Hit(
        rule_id=str(rule.get("id", "")),
        severity=str(rule.get("severity", "LOW")),
        file_path=file_path,
        line_no=line_no,
        line=line.rstrip("\n"),
        title=str(rule.get("title", "")),
        why=str(rule.get("why", "")),
        note=str(rule.get("note", "")),
        col_no=col + 1,
        match=needle
      ))
  return hits

def walk_files(root: str) -> List[str]:
  # root が「ファイル」なら、その1ファイルだけをチェック対象にする。
  # root が「ディレクトリ」なら、配下を再帰走査して全ファイルを候補にする。
  if os.path.isfile(root):
    return [root]
  out: List[str] = []
  for dirpath, dirnames, filenames in os.walk(root):
    # 大物ディレクトリはスキャン対象から除外（速度とノイズ低減）
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
      out.append(os.path.join(dirpath, fn))
  return out

def severity_rank(sev: str) -> int:
  s = sev.upper()
  if s == "HIGH":
    return 3
  if s == "MED":
    return 2
  if s == "LOW":
    return 1
  return 0

def main() -> int:
  script_dir = os.path.dirname(os.path.abspath(__file__))
  root = script_dir
  rules_path = None
  if len(sys.argv) >= 2:
    root = sys.argv[1]
  if len(sys.argv) >= 3:
    rules_path = sys.argv[2]

  rules = load_rules(rules_path)
  compiled_rules = [compile_rule(r) for r in rules]

  files = walk_files(root)
  all_hits: List[Hit] = []
  for fp in files:
    all_hits.extend(scan_file(fp, compiled_rules))

  all_hits.sort(key=lambda h: (-severity_rank(h.severity), h.file_path, h.line_no, h.rule_id))

  if not all_hits:
    print("[OK] No landmines detected by current rules.")
    return 0

  sev_counts = {"HIGH": 0, "MED": 0, "LOW": 0, "OTHER": 0}
  for h in all_hits:
    s = h.severity.upper()
    if s in sev_counts:
      sev_counts[s] += 1
    else:
      sev_counts["OTHER"] += 1

  # ルール別の件数（どの地雷が多いかを一発で把握する）
  rule_counts = {}
  for h in all_hits:
    rule_counts[h.rule_id] = rule_counts.get(h.rule_id, 0) + 1

  # 詳細ログは毎回上書き（script_dir 基準で固定）
  log_path = os.path.join(script_dir, "cf_landmine_check_log.txt")

  def console_quick_line(x: Hit, w_rule: int, w_file: int) -> str:
    rel = x.file_path
    try:
      rel = os.path.relpath(x.file_path, root)
    except Exception:
      pass

    # 長すぎるパスは「右側」を残す（ファイル名・末尾が見えるほうが有用）
    if w_file > 8 and len(rel) > w_file:
      rel = "…" + rel[-(w_file - 1):]

    loc = f"L{x.line_no}:C{x.col_no}"
    return f"{x.severity:<3}  {x.rule_id:<{w_rule}}  {rel:<{w_file}}  {loc}"

  def write_detail_log(fp) -> None:
    def lp(*args):
      print(*args, file=fp)

    SEP = "· " * 32

    # --- 実行メタ（再現性） ---
    import datetime
    import platform

    ts = datetime.datetime.now().isoformat(timespec="seconds")
    lp("[DETECTED] Potential Cloudflare landmines (detailed log)")
    lp(f"  Timestamp : {ts}")
    lp(f"  Root      : {root}")
    lp(f"  Log       : {log_path}")
    lp(f"  CWD       : {os.getcwd()}")
    lp(f"  Python    : {sys.version.replace(chr(10), ' ')}")
    lp(f"  Platform  : {platform.platform()}")
    lp(f"  SkipDirs  : {', '.join(sorted(list(SKIP_DIRS)))}")
    lp(f"  FilesScan : {len(files)} file(s)")
    lp(f"  TotalHits : {len(all_hits)}  |  HIGH: {sev_counts['HIGH']}  MED: {sev_counts['MED']}  LOW: {sev_counts['LOW']}")
    if sev_counts.get("OTHER", 0) > 0:
      lp(f"  OTHER     : {sev_counts['OTHER']}")
    lp("")

    # --- quick view（このログにも一応残す：後で grep しやすい） ---
    # --- quick view（幅を明示的に計算してから出力） ---
    w_rule = 0
    for h in all_hits:
      if len(h.rule_id) > w_rule:
        w_rule = len(h.rule_id)

    w_file = 72

    lp(SEP)
    lp("Quick view:")
    lp(f"{'SEV':<3}  {'RULE':<{w_rule}}  {'FILE':<{w_file}}  LOC")
    for h in all_hits:
      lp(console_quick_line(h, w_rule, w_file))
    lp("")
    lp(SEP)

    # --- ルール辞書（pattern/include_ext/why/note を hit から引けるように） ---
    rule_by_id = {}
    for r in rules:
      rid = str(r.get("id", ""))
      if rid:
        rule_by_id[rid] = r

    # --- ファイル行キャッシュ（同ファイルを何度も開かない） ---
    file_lines_cache: Dict[str, List[str]] = {}

    def get_file_lines(path: str) -> List[str]:
      if path in file_lines_cache:
        return file_lines_cache[path]
      try:
        with open(path, "r", encoding="utf-8", errors="replace") as rf:
          ls = rf.read().splitlines()
      except Exception:
        ls = []
      file_lines_cache[path] = ls
      return ls

    def safe_get_line(ls: List[str], idx0: int) -> str:
      if 0 <= idx0 < len(ls):
        return ls[idx0]
      return ""

    def write_context_block(path: str, line_no_1based: int, col_no_1based: int, context: int) -> None:
      ls = get_file_lines(path)
      if not ls:
        lp("  Context   : (failed to read file lines)")
        return

      center = line_no_1based - 1
      start = center - context
      end = center + context

      if start < 0:
        start = 0
      if end >= len(ls):
        end = len(ls) - 1

      lp("  Context   :")
      for i in range(start, end + 1):
        mark = " "
        if i == center:
          mark = ">"
        num = str(i + 1).rjust(5)
        lp(f"    {mark} L{num} | {ls[i]}")
        if i == center and col_no_1based > 0:
          caret = (" " * (col_no_1based - 1)) + "^"
          lp(f"      {' ' * 6} | {caret}")

    # --- 詳細（ファイルごと → ヒットごと） ---
    current_file = None
    file_hit_index = 0

    for h in all_hits:
      if h.file_path != current_file:
        current_file = h.file_path
        file_hit_index = 0
        lp("")
        lp(SEP)
        lp(f"File: {h.file_path}")

      file_hit_index += 1
      r = rule_by_id.get(h.rule_id, {})

      pat = str(r.get("pattern", ""))
      inc = r.get("include_ext", [])
      inc_str = ""
      if isinstance(inc, list):
        inc_str = ", ".join([str(x) for x in inc])

      lp("")
      lp(f"  Hit       : #{file_hit_index}")
      lp(f"  Severity  : {h.severity}")
      lp(f"  Rule      : {h.rule_id}")
      lp(f"  Title     : {h.title}")
      lp(f"  Location  : L{h.line_no}:C{h.col_no}")
      lp(f"  LineText  : {h.line}")
      if h.match:
        lp(f"  MatchText : {h.match}")
      if pat:
        lp(f"  Pattern   : {pat}")
      if inc_str:
        lp(f"  IncludeExt: {inc_str}")
      if h.why:
        lp(f"  Why       : {h.why}")
      if h.note:
        lp(f"  Note      : {h.note}")

      write_context_block(h.file_path, h.line_no, h.col_no, context=2)

    # --- ルール詳細（一覧） ---
    lp("")
    lp(SEP)
    lp("Rule details:")
    seen = set()
    for h in all_hits:
      if h.rule_id in seen:
        continue
      seen.add(h.rule_id)

      r = rule_by_id.get(h.rule_id, {})
      pat = str(r.get("pattern", ""))
      inc = r.get("include_ext", [])
      inc_str = ""
      if isinstance(inc, list):
        inc_str = ", ".join([str(x) for x in inc])

      lp(f"* {h.rule_id} ({h.severity})")
      lp(f"  - Title     : {h.title}")
      lp(f"  - Why       : {h.why}")
      if h.note:
        lp(f"  - Note      : {h.note}")
      if inc_str:
        lp(f"  - IncludeExt: {inc_str}")
      if pat:
        lp(f"  - Pattern   : {pat}")
      lp("")

    # --- End summary（下はサマリーだけ） ---
    lp("End summary:")
    lp(f"  Total: {len(all_hits)} hit(s)")
    lp(f"  HIGH : {sev_counts['HIGH']}")
    lp(f"  MED  : {sev_counts['MED']}")
    lp(f"  LOW  : {sev_counts['LOW']}")
    if sev_counts.get("OTHER", 0) > 0:
      lp(f"  OTHER: {sev_counts['OTHER']}")
    lp("")
    lp("  By rule:")
    for rid in sorted(rule_counts.keys()):
      lp(f"    - {rid}: {rule_counts[rid]}")
    lp("")
    lp("Usage:")
    lp("  python3 cf_landmine_check.py [root_dir(optional)] [rules.json(optional)]")
    lp("  (default root_dir: the directory containing this script)")
    lp("")

  # まず詳細ログへ全出力（毎回上書き）
  try:
    with open(log_path, "w", encoding="utf-8") as fp:
      try:
        write_detail_log(fp)
      except Exception as e:
        print("[ERROR] Exception while writing detail log", file=fp)
        print(e, file=fp)
        raise
  except Exception as e:
    print("[ERROR] Failed to write log file:", log_path)
    print("        ", e)

  # コンソールは簡易リストだけ（列を縦に揃えて簡潔に）
  print("[DETECTED] Potential Cloudflare landmines:")
  print(f"  Total: {len(all_hits)}  |  HIGH: {sev_counts['HIGH']}  MED: {sev_counts['MED']}  LOW: {sev_counts['LOW']}")
  if sev_counts.get("OTHER", 0) > 0:
    print(f"  OTHER: {sev_counts['OTHER']}")
  print("")

  w_rule = 0
  for h in all_hits:
    if len(h.rule_id) > w_rule:
      w_rule = len(h.rule_id)

  w_file = 72
  header = f"{'SEV':<3}  {'RULE':<{w_rule}}  {'FILE':<{w_file}}  LOC"
  print(header)
  print("")

  for h in all_hits:
    print(console_quick_line(h, w_rule, w_file))

  print("")
  print(f"Details: {log_path}")
  print("")
  return 2

if __name__ == "__main__":
  raise SystemExit(main())