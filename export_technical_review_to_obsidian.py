from pathlib import Path
import shutil

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parent
DOCX_PATH = ROOT / "技术复盘" / "汤淡采集_抖音监控飞书入库与逐字稿技术复盘_v0.3.8.docx"
ARCHITECTURE_PATH = ROOT / "技术复盘" / "architecture.png"
VAULT = ROOT / "Obsidian导出"
NOTE_DIR = VAULT / "AI资料库" / "03-AI工作流"
ASSET_DIR = NOTE_DIR / "assets"
NOTE_PATH = NOTE_DIR / "汤淡采集-抖音监控飞书入库与逐字稿技术复盘-v0.3.8.md"
ASSET_PATH = ASSET_DIR / "汤淡采集-系统架构-v0.3.8.png"


def iter_blocks(document):
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def inline_markdown(paragraph):
    parts = []
    for run in paragraph.runs:
        text = run.text.replace("\u00a0", " ")
        if not text:
            continue
        if run.bold and run.italic:
            text = f"***{text}***"
        elif run.bold:
            text = f"**{text}**"
        elif run.italic:
            text = f"*{text}*"
        parts.append(text)
    return "".join(parts).strip() or paragraph.text.strip()


def has_picture(paragraph):
    return bool(paragraph._p.xpath(".//a:blip"))


def is_numbered(paragraph):
    p_pr = paragraph._p.pPr
    return bool(p_pr is not None and p_pr.numPr is not None)


def callout_fill(paragraph):
    p_pr = paragraph._p.pPr
    if p_pr is None:
        return ""
    shd = p_pr.find(qn("w:shd"))
    return shd.get(qn("w:fill"), "") if shd is not None else ""


def paragraph_callout(paragraph):
    text = paragraph.text.strip()
    bold_prefix = "".join(run.text for run in paragraph.runs if run.bold).strip()
    label = bold_prefix or "说明"
    body = text[len(label):].strip() if text.startswith(label) else text
    kind = "warning" if callout_fill(paragraph).upper() == "FFF8E8" else "info"
    return [f"> [!{kind}] {label}", f"> {body}"]


def escape_table_cell(value):
    return " ".join(value.split()).replace("|", "\\|")


def table_to_markdown(table):
    rows = [[escape_table_cell(cell.text) for cell in row.cells] for row in table.rows]
    if not rows:
        return []
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    output = [
        "| " + " | ".join(rows[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    output.extend("| " + " | ".join(row) + " |" for row in rows[1:])
    return output


def export_note():
    document = Document(DOCX_PATH)
    lines = [
        "---",
        'title: "汤淡采集：抖音私聊监控、飞书入库与逐字稿自动化技术复盘"',
        "aliases:",
        "  - 汤淡采集技术复盘",
        "  - 抖音转发飞书自动化复盘",
        "tags:",
        "  - 技术复盘",
        "  - 抖音自动化",
        "  - 飞书多维表格",
        "  - Chrome扩展",
        "  - 逐字稿",
        "created: 2026-08-09",
        "version: 0.3.8",
        "status: 完成",
        "---",
        "",
        "# 汤淡采集：抖音私聊监控、飞书入库与逐字稿自动化",
        "",
        "> [!summary] 一句话结论",
        "> 最终系统把“发现内容、读取作品、写入飞书、按需转写”拆成可恢复的异步链路。页面只负责快速识别和取数，耗时的网络写入与转写交给后台队列，因此连续转发不再卡在上一条视频。",
        "",
        "- 当前版本：`0.3.8`",
        "- 系统形态：本机 Chrome 扩展 + 飞书多维表格 + 阿里云 DashScope",
        "- 复盘日期：2026-08-09",
        "- 安全说明：本文不包含多维表格授权码、API Key 或 App Secret",
        "",
    ]

    started = False
    list_mode = None
    for block in iter_blocks(document):
        if isinstance(block, Paragraph):
            style_name = block.style.name if block.style else ""
            if style_name == "Heading 1":
                started = True
            if not started:
                continue

            if has_picture(block):
                if list_mode:
                    lines.append("")
                    list_mode = None
                lines.extend([f"![[assets/{ASSET_PATH.name}]]", ""])
                continue

            text = block.text.strip()
            if not text:
                continue

            if style_name.startswith("Heading "):
                if list_mode:
                    lines.append("")
                    list_mode = None
                level = int(style_name.split()[-1]) + 1
                lines.extend([f"{'#' * level} {text}", ""])
                continue

            fill = callout_fill(block)
            if fill:
                if list_mode:
                    lines.append("")
                    list_mode = None
                lines.extend(paragraph_callout(block) + [""])
                continue

            if style_name.startswith("List Bullet"):
                lines.append(f"- {inline_markdown(block)}")
                list_mode = "bullet"
                continue

            if is_numbered(block):
                lines.append(f"1. {inline_markdown(block)}")
                list_mode = "number"
                continue

            if list_mode:
                lines.append("")
                list_mode = None
            if text.startswith("图 1"):
                lines.extend([f"*{text}*", ""])
            else:
                lines.extend([inline_markdown(block), ""])
        else:
            if not started:
                continue
            if list_mode:
                lines.append("")
                list_mode = None
            lines.extend(table_to_markdown(block) + [""])

    while lines and not lines[-1].strip():
        lines.pop()
    lines.append("")

    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ARCHITECTURE_PATH, ASSET_PATH)
    NOTE_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(NOTE_PATH)
    print(ASSET_PATH)


if __name__ == "__main__":
    export_note()
