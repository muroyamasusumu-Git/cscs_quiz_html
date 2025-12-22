#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple


@dataclass
class Chunk:
    index: int
    chunk_id: str
    start_line: int
    end_line: int
    char_count: int
    sha1: str
    text: str


def sha1_text(s: str) -> str:
    h = hashlib.sha1()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


def safe_mkdir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def normalize_newlines(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return s


def choose_breakpoint(lines: List[str], start: int, end_exclusive: int) -> int:
    """
    lines[start:end_exclusive] を分割する際の「なるべく自然な区切り」を探す。
    返す値は「分割点（次チャンクのstartになる index）」。
    見つからなければ end_exclusive を返す（= そのまま切る）。
    """
    if end_exclusive <= start:
        return start

    window = 80
    search_start = max(start, end_exclusive - window)
    candidate = None

    blank_re = re.compile(r"^\s*$")
    good_end_re = re.compile(r"^\s*(\}|\}\);|\}\);\s*//.*|\}\s*//.*)\s*$")

    for i in range(end_exclusive - 1, search_start - 1, -1):
        line = lines[i]
        if blank_re.match(line):
            candidate = i + 1
            break
        if good_end_re.match(line):
            candidate = i + 1
            break

    if candidate is None:
        return end_exclusive

    if candidate <= start:
        return end_exclusive

    return candidate


def split_text_into_chunks(
    full_text: str,
    base_id: str,
    max_chars: int,
    max_lines: int
) -> List[Chunk]:
    full_text = normalize_newlines(full_text)
    lines = full_text.split("\n")

    chunks: List[Chunk] = []

    n = len(lines)
    i = 0
    chunk_idx = 1

    while i < n:
        start = i
        char_count = 0
        line_count = 0

        j = i
        while j < n:
            line = lines[j]
            add_chars = len(line) + 1
            if line_count + 1 > max_lines:
                break
            if char_count + add_chars > max_chars and line_count > 0:
                break
            char_count += add_chars
            line_count += 1
            j += 1

        if j < n:
            bp = choose_breakpoint(lines, start, j)
            if bp != j:
                j = bp
                joined = "\n".join(lines[start:j])
                char_count = len(joined) + 1
                line_count = j - start

        chunk_text = "\n".join(lines[start:j])
        chunk_sha1 = sha1_text(chunk_text)

        chunk_id = f"{base_id}_P{chunk_idx:03d}"
        chunks.append(
            Chunk(
                index=chunk_idx,
                chunk_id=chunk_id,
                start_line=start + 1,
                end_line=j,
                char_count=len(chunk_text),
                sha1=chunk_sha1,
                text=chunk_text,
            )
        )

        i = j
        chunk_idx += 1

    return chunks


def build_base_id(input_path: Path, full_text: str) -> Tuple[str, str]:
    """
    base_id: ファイル名 + 先頭8桁hash
    file_sha1: 元ファイルsha1
    """
    file_sha1 = sha1_text(normalize_newlines(full_text))
    stem = input_path.stem
    base_id = f"{stem}_{file_sha1[:8]}"
    return base_id, file_sha1


def make_chunk_file_text(
    input_path: Path,
    base_id: str,
    total_chunks: int,
    chunk: Chunk
) -> str:
    header = []
    header.append("【分割コードの貼り付けを宣言する】")
    header.append(f"対象ファイル: {input_path.name}")
    header.append(f"BASE_ID: {base_id}")
    header.append(f"CHUNK_ID: {chunk.chunk_id}")
    header.append(f"順序: {chunk.index}/{total_chunks}")
    header.append(f"行範囲: L{chunk.start_line}-L{chunk.end_line}")
    header.append(f"CHUNK_SHA1: {chunk.sha1}")
    header.append("")
    header.append(f"【分割コード({chunk.index})の開始を宣言する: {chunk.chunk_id}】")
    header.append("```javascript")
    header.append(chunk.text)
    header.append("```")
    if chunk.index < total_chunks:
        header.append(f"【分割コード({chunk.index})の終了を宣言し、続きの分割コード({chunk.index + 1})があることを宣言する: {chunk.chunk_id}】")
    else:
        header.append(f"【分割コード({chunk.index})の終了を宣言する（最終）: {chunk.chunk_id}】")
    header.append("")
    return "\n".join(header)


def make_protocol_send_text(
    input_path: Path,
    base_id: str,
    file_sha1: str,
    chunks: List[Chunk],
    max_chars: int,
    max_lines: int
) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = []
    lines.append("=== ChatGPT 用：分割コード送信プロトコル ===")
    lines.append(f"生成日時: {now}")
    lines.append(f"対象ファイル: {input_path.name}")
    lines.append(f"BASE_ID: {base_id}")
    lines.append(f"元ファイル SHA1: {file_sha1}")
    lines.append(f"分割数: {len(chunks)}")
    lines.append(f"分割上限: max_chars={max_chars}, max_lines={max_lines}")
    lines.append("")
    lines.append("【指示内容①（ここに目的を書く）】")
    lines.append("下記の分割コードを参照して、BASE_ID をキーとして全チャンクを連結し、分割前の完全なコードとして解析・改修してください。")
    lines.append("各チャンクは CHUNK_ID と順序（n/N）が明示されています。順番通りに連結し、元ファイル SHA1 と一致するかを前提に扱ってください。")
    lines.append("")
    lines.append("【分割コードの貼り付けを宣言する】")
    lines.append(f"これから {len(chunks)} 個の分割コードを送ります。BASE_ID は {base_id} です。")
    lines.append("各メッセージは 1チャンクのみ貼り付け、チャンクの開始/終了宣言を含めます。")
    lines.append("")
    for c in chunks:
        lines.append(f"- 送信順: {c.index}/{len(chunks)}  CHUNK_ID={c.chunk_id}  L{c.start_line}-L{c.end_line}  CHUNK_SHA1={c.sha1}")
    lines.append("")
    lines.append("【注意】")
    lines.append("- 途中で会話が挟まっても、CHUNK_ID と順序で再構成してください。")
    lines.append("- もしチャンク欠落がある場合は、欠落CHUNK_IDを列挙して指摘してください（推測で補完しない）。")
    lines.append("- 解析の前に「受領したCHUNK_ID一覧」と「欠落なし」を明示してください。")
    lines.append("")
    lines.append("=== ここから、chunks/ の各 CHUNK_*.txt を順番に貼り付け ===")
    lines.append("")
    return "\n".join(lines)


def make_rebuild_script_text() -> str:
    return """#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import hashlib
import json
from pathlib import Path


def sha1_text(s: str) -> str:
    h = hashlib.sha1()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, help="manifest.json path")
    ap.add_argument("--out", required=True, help="reconstructed output file path")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    out_path = Path(args.out)

    data = json.loads(manifest_path.read_text(encoding="utf-8"))

    base_id = data["base_id"]
    file_sha1_expected = data["file_sha1"]
    chunks = data["chunks"]

    buf = []
    for c in chunks:
        chunk_file = Path(c["chunk_file"])
        text = chunk_file.read_text(encoding="utf-8")
        start = text.find("```javascript")
        if start == -1:
            raise SystemExit(f"Missing code fence in: {chunk_file}")
        start = start + len("```javascript")
        if start < len(text) and text[start] == "\\n":
            start += 1
        end = text.find("```", start)
        if end == -1:
            raise SystemExit(f"Missing closing fence in: {chunk_file}")
        code = text[start:end]
        sha1_got = sha1_text(code)
        if sha1_got != c["chunk_sha1"]:
            raise SystemExit(f"CHUNK_SHA1 mismatch: {c['chunk_id']} expected={c['chunk_sha1']} got={sha1_got}")
        buf.append(code)

    reconstructed = "\\n".join(buf)
    file_sha1_got = sha1_text(reconstructed)
    if file_sha1_got != file_sha1_expected:
        raise SystemExit(
            "FILE_SHA1 mismatch\\n"
            f"base_id={base_id}\\n"
            f"expected={file_sha1_expected}\\n"
            f"got={file_sha1_got}"
        )

    out_path.write_text(reconstructed, encoding="utf-8")
    print("OK: reconstructed")
    print(f"base_id={base_id}")
    print(f"file_sha1={file_sha1_got}")
    print(f"out={out_path}")


if __name__ == "__main__":
    main()
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="input .js file path")
    ap.add_argument("--outdir", required=True, help="output directory")
    ap.add_argument("--max-chars", type=int, default=12000, help="max characters per chunk")
    ap.add_argument("--max-lines", type=int, default=350, help="max lines per chunk")
    args = ap.parse_args()

    input_path = Path(args.input)
    outdir = Path(args.outdir)

    if not input_path.exists() or not input_path.is_file():
        raise SystemExit(f"Input not found: {input_path}")

    full_text = input_path.read_text(encoding="utf-8", errors="strict")

    base_id, file_sha1 = build_base_id(input_path, full_text)

    chunks = split_text_into_chunks(
        full_text=full_text,
        base_id=base_id,
        max_chars=args.max_chars,
        max_lines=args.max_lines
    )

    safe_mkdir(outdir)
    chunks_dir = outdir / "chunks"
    safe_mkdir(chunks_dir)

    for c in chunks:
        chunk_file = chunks_dir / f"CHUNK_{c.chunk_id}.txt"
        chunk_file.write_text(
            make_chunk_file_text(input_path, base_id, len(chunks), c),
            encoding="utf-8"
        )

    protocol_text = make_protocol_send_text(
        input_path=input_path,
        base_id=base_id,
        file_sha1=file_sha1,
        chunks=chunks,
        max_chars=args.max_chars,
        max_lines=args.max_lines
    )
    (outdir / "protocol_send.txt").write_text(protocol_text, encoding="utf-8")

    manifest = {
        "version": "1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "input_file": str(input_path),
        "input_name": input_path.name,
        "base_id": base_id,
        "file_sha1": file_sha1,
        "chunk_count": len(chunks),
        "limits": {"max_chars": args.max_chars, "max_lines": args.max_lines},
        "chunks": []
    }

    for c in chunks:
        chunk_file = str((chunks_dir / f"CHUNK_{c.chunk_id}.txt").as_posix())
        manifest["chunks"].append(
            {
                "index": c.index,
                "chunk_id": c.chunk_id,
                "start_line": c.start_line,
                "end_line": c.end_line,
                "char_count": c.char_count,
                "chunk_sha1": c.sha1,
                "chunk_file": chunk_file,
            }
        )

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    (outdir / "rebuild_from_manifest.py").write_text(
        make_rebuild_script_text(),
        encoding="utf-8"
    )

    print("DONE")
    print(f"base_id={base_id}")
    print(f"file_sha1={file_sha1}")
    print(f"chunks={len(chunks)}")
    print(f"outdir={outdir}")


if __name__ == "__main__":
    main()