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
# - 本ツールは「正規表現で全文スキャン」するため、
#   実コードだけでなく、コメントやログ文字列に含まれる表現も検出対象になる。
# - その代わり「見落とし」を減らし、危険ワードを早期に棚卸しできる設計。
# - 誤検出を減らしたい場合は、将来的に AST 解析へ移行するか、
#   ルール側のパターンをより限定的にする。
# ============================================================
DEFAULT_RULES = [
  {
    "id": "KV_CACHE_TTL_ZERO",
    "title": "Workers KV: cacheTtl: 0 は不正（minimum 60）",
    "severity": "HIGH",
    "why": "KV の cacheTtl は 60秒以上が必須。0 を渡すと例外→catch→再試行で無限ループの原因になる。",
    "include_ext": [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
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

def scan_file(file_path: str, compiled_rules: List[Tuple[Pattern, Dict]]) -> List[Hit]:
  hits: List[Hit] = []
  try:
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
      text = f.read()
  except Exception:
    return hits

  lines = text.splitlines()
  for (rx, rule) in compiled_rules:
    include_ext = rule.get("include_ext", [])
    if include_ext and not should_scan_file(file_path, include_ext):
      continue

    for m in rx.finditer(text):
      start = m.start()
      line_no = text.count("\n", 0, start) + 1
      line = lines[line_no - 1] if 1 <= line_no <= len(lines) else ""
      hits.append(Hit(
        rule_id=str(rule.get("id", "")),
        severity=str(rule.get("severity", "LOW")),
        file_path=file_path,
        line_no=line_no,
        line=line.rstrip("\n"),
        title=str(rule.get("title", "")),
        why=str(rule.get("why", "")),
        note=str(rule.get("note", "")),
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

  print("[DETECTED] Potential Cloudflare landmines:")
  print("")
  current = None
  for h in all_hits:
    key = (h.rule_id, h.file_path)
    if key != current:
      current = key
      print(f"- [{h.severity}] {h.rule_id}: {h.title}")
      print(f"  File: {h.file_path}")
    print(f"    L{h.line_no}: {h.line}")
  print("")
  print("Details:")
  seen = set()
  for h in all_hits:
    if h.rule_id in seen:
      continue
    seen.add(h.rule_id)
    print(f"* {h.rule_id} ({h.severity})")
    print(f"  - {h.title}")
    print(f"  - Why: {h.why}")
    if h.note:
      print(f"  - Note: {h.note}")
  print("")
  print("Usage:")
  print("  python3 cf_landmine_check.py [root_dir(optional)] [rules.json(optional)]")
  print("  (default root_dir: the directory containing this script)")
  print("")
  return 2

if __name__ == "__main__":
  raise SystemExit(main())