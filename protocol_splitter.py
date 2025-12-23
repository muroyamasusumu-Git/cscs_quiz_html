#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Tuple


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


def read_text_file(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")
    data = path.read_text(encoding="utf-8")
    return data


def sha256_hex(s: str) -> str:
    h = hashlib.sha256()
    h.update(s.encode("utf-8"))
    return h.hexdigest()


def make_session_id(prefix: str, file_text: str) -> str:
    digest8 = sha256_hex(file_text)[:8].upper()
    return f"{prefix}-{digest8}"


def safe_mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def split_by_limits(text: str, max_chars: int, max_lines: int) -> List[Tuple[int, int, str]]:
    """
    Returns list of (start, end, chunk).
    Splits by BOTH:
      - max_chars (approx upper bound)
      - max_lines (approx upper bound; counted by '\n')
    Tries to split on '\n' boundary near the chosen limit.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be > 0")
    if max_lines <= 0:
        raise ValueError("max_lines must be > 0")

    n = len(text)
    if n == 0:
        return [(0, 0, "")]

    parts: List[Tuple[int, int, str]] = []
    start = 0

    while start < n:
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
            nl = text.rfind("\n", start, tentative_end)
            if nl == -1 or nl <= start:
                end = tentative_end
            else:
                end = nl + 1

        chunk = text[start:end]
        parts.append((start, end, chunk))
        start = end

    return parts


def build_part_id(session_id: str, idx: int, total: int) -> str:
    return f"{session_id}-P{idx:02d}-of-{total:02d}"


def build_expected_partids(parts: List[SplitPart]) -> List[str]:
    expected: List[str] = []
    for p in parts:
        expected.append(p.part_id)
    return expected


def build_cumulative_partids(parts: List[SplitPart], upto_index_inclusive: int) -> List[str]:
    cumulative: List[str] = []
    for p in parts:
        if p.index <= upto_index_inclusive:
            cumulative.append(p.part_id)
    return cumulative


def build_exec_task_block(exec_task_text: str) -> str:
    """
    EXEC_TASK is embedded ONLY in the LAST PART.
    It is the ONLY authoritative instruction for execution.
    """
    lines: List[str] = []
    lines.append("【EXEC_TASK（このメッセージ内だけを真とする：唯一の実行指示）】")
    if exec_task_text.strip():
        lines.append(exec_task_text.strip())
    else:
        lines.append("（EXEC_TASK が空です。ユーザー指示が不足しています。）")

    lines.append("")
    lines.append(EXEC_TASK_PATCH_RULES.rstrip())

    lines.append("")
    lines.append("【ChatGPT 実行ルール（強制）】")
    lines.append("・RECEIPT_CHECK: OK の場合、実行対象は上記 EXEC_TASK のみ。別の問題分析や一般論は禁止。")
    lines.append("・EXEC_TASK の実現に必要な識別子/DOM/関数が連結JS内に見当たらない場合は、SCOPE_CHECK: FAIL を返して停止し、")
    lines.append("  『どのファイル/どの箇所が必要か』を具体的に要求する（推測で別作業を開始しない）。")
    lines.append("・SCOPE_CHECK: FAIL の場合は、修正案や改善案を勝手に提示しない。まず不足情報を要求する。")
    return "\n".join(lines)


def build_receipt_input_block(
    cumulative_ids: List[str],
    expected_ids: List[str],
    is_last: bool,
    exec_task_text: str,
) -> str:
    """
    Embedded INSIDE each part payload so that receipt check can be done
    without relying on chat history. ChatGPT must use ONLY the lists contained here.
    For LAST part, also embeds EXEC_TASK (authoritative instruction) and expected IDs.
    """
    lines: List[str] = []
    lines.append("【RECEIPT_INPUT（このメッセージ内だけを真とする）】")
    lines.append("CUMULATIVE_RECEIVED_PARTIDS:")
    for pid in cumulative_ids:
        lines.append(f"- {pid}")

    if is_last:
        lines.append("")
        lines.append("EXPECTED_PARTIDS:")
        for pid in expected_ids:
            lines.append(f"- {pid}")

    lines.append("")
    lines.append("【ChatGPTへの強制ルール】")
    lines.append("・受領確認は、このメッセージ内の CUMULATIVE_RECEIVED_PARTIDS と EXPECTED_PARTIDS のみを使用すること。")
    lines.append("・会話履歴から PartID を再収集しないこと（禁止）。")
    lines.append("・受領確認OK前に、コード内容の解釈・要約・推測・修正案提示をしないこと（禁止）。")

    if is_last:
        lines.append("")
        lines.append(build_exec_task_block(exec_task_text))

    lines.append("")
    return "\n".join(lines)


def build_protocol_preamble(
    session_id: str,
    input_filename: str,
    total_parts: int,
    max_chars: int,
    max_lines: int,
    user_instruction: str,
) -> str:
    """
    PART_01 preamble: declaration only.
    IMPORTANT: execution must rely ONLY on EXEC_TASK embedded in LAST PART.
    """
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
    lines.append("4) 実行指示（EXEC_TASK）は『最終メッセージ内の EXEC_TASK』のみを真とする。PART_01の指示文は参照してもよいが、実行根拠にしない。")
    lines.append("5) RECEIPT_CHECK: OK の同一返信内で、JOIN_READY/JOIN_ACTION/EXEC_START を必ず出力し、直ちに EXEC_TASK を実行する。")
    lines.append("")
    lines.append("【指示内容（概要：参考用／実行根拠にしない）】")
    if user_instruction.strip():
        lines.append(user_instruction.strip())
    else:
        lines.append("（未設定：実行は最終パートの EXEC_TASK に依存する。EXEC_TASK が空なら SCOPE_CHECK: FAIL で停止する。）")
    lines.append("")
    lines.append("【分割コード貼り付け開始】")
    lines.append("以降は分割コード本文。上記ルールに従って受領・照合・実行せよ。")
    lines.append("")
    return "\n".join(lines)


def build_protocol_epilogue() -> str:
    """
    LAST PART epilogue: forces receipt check + join + execute in same reply.
    Execution must be based ONLY on EXEC_TASK embedded in LAST PART.
    """
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
    """
    Paste-ready payload.
    - PART_01 contains protocol preamble (declaration).
    - EVERY part contains RECEIPT_INPUT with cumulative PartIDs.
    - LAST part contains EXPECTED_PARTIDS + EXEC_TASK (authoritative) inside RECEIPT_INPUT, and epilogue.
    """
    header_lines: List[str] = []
    header_lines.append(f"【分割コード({part.index})の開始】")
    header_lines.append(f"PartID: {part.part_id}")
    header_lines.append(f"Range: chars {part.start_offset}..{part.end_offset} (len={len(part.text)})")
    header_lines.append("")

    if part.index == 1:
        header_lines.append(protocol_preamble)

    header_lines.append(f"```{language_tag}")
    header_text = "\n".join(header_lines)

    footer_lines: List[str] = []
    footer_lines.append("```")
    footer_lines.append(receipt_input_block)

    if part.index < part.total:
        footer_lines.append(f"【分割コード({part.index})の終了】→ 次は 分割コード({part.index + 1}) を送ります")
        footer_lines.append("【ChatGPTへの指示】解釈・要約・推測・修正案提示は禁止。返答は次のみ。")
        footer_lines.append("ACK: <PartID> / WAITING_NEXT")
    else:
        footer_lines.append(f"【分割コード({part.index})の終了】→ これで最後です（全{part.total}分割）")
        footer_lines.append(protocol_epilogue)

    footer_text = "\n".join(footer_lines)

    return header_text + "\n" + part.text + "\n" + footer_text + "\n"


def write_manifest_json(
    out_dir: Path,
    session_id: str,
    input_path: Path,
    total_parts: int,
    max_chars: int,
    max_lines: int,
    parts: List[SplitPart],
    original_sha256: str,
) -> None:
    manifest = {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "input": {
            "path": str(input_path),
            "filename": input_path.name,
            "size_chars": sum(len(p.text) for p in parts),
            "sha256": original_sha256,
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
                "start_offset": p.start_offset,
                "end_offset": p.end_offset,
                "len_chars": len(p.text),
                "file": f"parts/part_{p.index:02d}.txt",
            }
            for p in parts
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=(
            "Split JS into chat-pasteable parts with embedded protocol.\n"
            "- PART_01: protocol declaration.\n"
            "- LAST PART: receipt check + EXEC_TASK (authoritative) + forced join/execute.\n"
            "- Receipt check uses ONLY lists embedded in LAST message (no chat history)."
        )
    )
    ap.add_argument("--in", dest="input_file", required=True, help="Input JS file path")
    ap.add_argument("--outdir", dest="outdir", required=True, help="Output folder path (created if missing)")
    ap.add_argument("--prefix", dest="prefix", default="CSCSJS", help="SessionID prefix (default: CSCSJS)")
    ap.add_argument("--maxchars", dest="maxchars", type=int, default=60000, help="Max characters per part (default: 60000)")
    ap.add_argument("--maxlines", dest="maxlines", type=int, default=1200, help="Max lines per part (default: 1200)")
    ap.add_argument("--lang", dest="lang", default="javascript", help="Code block language tag (default: javascript)")
    ap.add_argument("--instruction", dest="instruction", default="", help="Instruction text (embedded as overview in PART_01; authoritative EXEC_TASK in LAST PART)")
    args = ap.parse_args()

    input_path = Path(args.input_file).expanduser().resolve()
    out_dir = Path(args.outdir).expanduser().resolve()

    js_text = read_text_file(input_path)
    original_hash = sha256_hex(js_text)
    session_id = make_session_id(args.prefix, js_text)

    split_chunks = split_by_limits(js_text, args.maxchars, args.maxlines)
    print(f"[split] OK: produced {len(split_chunks)} chunks (maxchars={args.maxchars}, maxlines={args.maxlines})")
    for i, (st, ed, ch) in enumerate(split_chunks, start=1):
        line_count = ch.count("\n") + 1 if len(ch) > 0 else 0
        print(f"[split] part {i:02d}: chars={len(ch)} lines~={line_count} range={st}..{ed}")

    total_parts = len(split_chunks)

    safe_mkdir(out_dir)
    parts_dir = out_dir / "parts"
    safe_mkdir(parts_dir)

    parts: List[SplitPart] = []
    for idx, (start, end, chunk) in enumerate(split_chunks, start=1):
        part_id = build_part_id(session_id, idx, total_parts)
        part = SplitPart(
            index=idx,
            total=total_parts,
            part_id=part_id,
            text=chunk,
            start_offset=start,
            end_offset=end,
        )
        parts.append(part)

    expected_ids = build_expected_partids(parts)

    protocol_preamble = build_protocol_preamble(
        session_id=session_id,
        input_filename=input_path.name,
        total_parts=total_parts,
        max_chars=args.maxchars,
        max_lines=args.maxlines,
        user_instruction=args.instruction,
    )
    protocol_epilogue = build_protocol_epilogue()

    for p in parts:
        cumulative_ids = build_cumulative_partids(parts, p.index)
        receipt_input_block = build_receipt_input_block(
            cumulative_ids=cumulative_ids,
            expected_ids=expected_ids,
            is_last=(p.index == p.total),
            exec_task_text=args.instruction,
        )

        payload = make_part_payload(
            part=p,
            language_tag=args.lang,
            protocol_preamble=protocol_preamble,
            receipt_input_block=receipt_input_block,
            protocol_epilogue=protocol_epilogue,
        )
        (parts_dir / f"part_{p.index:02d}.txt").write_text(payload, encoding="utf-8")

    write_manifest_json(
        out_dir=out_dir,
        session_id=session_id,
        input_path=input_path,
        total_parts=total_parts,
        max_chars=args.maxchars,
        max_lines=args.maxlines,
        parts=parts,
        original_sha256=original_hash,
    )

    print("OK")
    print(f"SessionID: {session_id}")
    print(f"Input: {input_path}")
    print(f"Output: {out_dir}")
    print(f"Parts: {total_parts}  (maxchars={args.maxchars}, maxlines={args.maxlines})")
    print("Generated: manifest.json / parts/part_XX.txt")


if __name__ == "__main__":
    main()