from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "技术复盘"
OUT_PATH = OUT_DIR / "汤淡采集_抖音监控飞书入库与逐字稿技术复盘_v0.3.8.docx"
DIAGRAM_PATH = OUT_DIR / "architecture.png"

BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
INK = "1F2937"
MUTED = "667085"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
PALE_BLUE = "F4F7FB"
GREEN = "16803A"
AMBER = "8A6100"
RED = "A61B1B"
WHITE = "FFFFFF"
BLACK = "000000"
FONT_LATIN = "Source Han Sans CN"
FONT_CJK = "Source Han Sans CN"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa, indent_dxa=120):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths_dxa)))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent_dxa))
    tbl_ind.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            width = widths_dxa[min(idx, len(widths_dxa) - 1)]
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(width))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    cant_split.set(qn("w:val"), "true")
    tr_pr.append(cant_split)


def set_run_font(run, size=None, bold=None, color=INK, italic=None, latin=FONT_LATIN, cjk=FONT_CJK):
    run.font.name = latin
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), latin)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), latin)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), cjk)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def style_paragraph(paragraph, before=0, after=6, line=1.1, keep_next=False):
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    fmt.keep_with_next = keep_next


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph(style="Normal")
    if bold_lead and text.startswith(bold_lead):
        lead = p.add_run(bold_lead)
        set_run_font(lead, bold=True)
        rest = p.add_run(text[len(bold_lead):])
        set_run_font(rest)
    else:
        run = p.add_run(text)
        set_run_font(run)
    return p


def add_bullets(doc, items, level=0):
    for item in items:
        p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
        run = p.add_run(item)
        set_run_font(run)


def create_decimal_numbering(doc):
    numbering = doc.part.numbering_part.element
    abstract_ids = [
        int(node.get(qn("w:abstractNumId")))
        for node in numbering.findall(qn("w:abstractNum"))
        if node.get(qn("w:abstractNumId")) is not None
    ]
    num_ids = [
        int(node.get(qn("w:numId")))
        for node in numbering.findall(qn("w:num"))
        if node.get(qn("w:numId")) is not None
    ]
    abstract_id = max(abstract_ids or [0]) + 1
    num_id = max(num_ids or [0]) + 1

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    level = OxmlElement("w:lvl")
    level.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    num_fmt = OxmlElement("w:numFmt")
    num_fmt.set(qn("w:val"), "decimal")
    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), "%1.")
    lvl_jc = OxmlElement("w:lvlJc")
    lvl_jc.set(qn("w:val"), "left")
    p_pr = OxmlElement("w:pPr")
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "num")
    tab.set(qn("w:pos"), "720")
    tabs.append(tab)
    indent = OxmlElement("w:ind")
    indent.set(qn("w:left"), "720")
    indent.set(qn("w:hanging"), "360")
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:after"), "160")
    spacing.set(qn("w:line"), "280")
    spacing.set(qn("w:lineRule"), "auto")
    p_pr.extend([tabs, indent, spacing])
    level.extend([start, num_fmt, lvl_text, lvl_jc, p_pr])
    abstract.append(level)
    numbering.append(abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)
    return num_id


def add_numbered(doc, items):
    num_id = create_decimal_numbering(doc)
    for item in items:
        p = doc.add_paragraph(style="Normal")
        p_pr = p._p.get_or_add_pPr()
        num_pr = OxmlElement("w:numPr")
        ilvl = OxmlElement("w:ilvl")
        ilvl.set(qn("w:val"), "0")
        num_id_node = OxmlElement("w:numId")
        num_id_node.set(qn("w:val"), str(num_id))
        num_pr.extend([ilvl, num_id_node])
        p_pr.append(num_pr)
        style_paragraph(p, after=8, line=1.167)
        run = p.add_run(item)
        set_run_font(run)


def add_callout(doc, label, text, fill=PALE_BLUE, color=DARK_BLUE):
    p = doc.add_paragraph()
    style_paragraph(p, before=4, after=10, line=1.15)
    p.paragraph_format.left_indent = Inches(0.16)
    p.paragraph_format.right_indent = Inches(0.08)
    p_pr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)
    borders = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "18")
    left.set(qn("w:space"), "8")
    left.set(qn("w:color"), color)
    borders.append(left)
    p_pr.append(borders)
    lead = p.add_run(f"{label}  ")
    set_run_font(lead, bold=True, color=color)
    body = p.add_run(text)
    set_run_font(body, color=INK)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    for run in p.runs:
        set_run_font(run, bold=True, color=BLUE if level < 3 else DARK_BLUE)
    p.paragraph_format.keep_with_next = True
    return p


def add_table(doc, headers, rows, widths_dxa, status_col=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.rows[0].height = None
    repeat_table_header(table.rows[0])
    prevent_row_split(table.rows[0])
    for idx, header in enumerate(headers):
        cell = table.rows[0].cells[idx]
        set_cell_shading(cell, LIGHT_GRAY)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        style_paragraph(p, after=0, line=1.08)
        run = p.add_run(header)
        set_run_font(run, size=9.4, bold=True, color=DARK_BLUE)
    for row_data in rows:
        row = table.add_row()
        prevent_row_split(row)
        for idx, value in enumerate(row_data):
            cell = row.cells[idx]
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if (status_col == idx or len(str(value)) < 14) else WD_ALIGN_PARAGRAPH.LEFT
            style_paragraph(p, after=0, line=1.08)
            color = INK
            if status_col == idx:
                value_text = str(value)
                if "完成" in value_text or "通过" in value_text or "稳定" in value_text:
                    color = GREEN
                elif "风险" in value_text or "失败" in value_text:
                    color = RED
                elif "等待" in value_text or "处理中" in value_text:
                    color = AMBER
            run = p.add_run(str(value))
            set_run_font(run, size=9.2, color=color, bold=(status_col == idx))
    set_table_geometry(table, widths_dxa)
    spacer = doc.add_paragraph()
    style_paragraph(spacer, after=3)
    return table


def add_page_field(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("第 ")
    set_run_font(run, size=9, color=MUTED)
    for field_name, suffix in (("PAGE", " 页 / 共 "), ("NUMPAGES", " 页")):
        begin = OxmlElement("w:fldChar")
        begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = field_name
        separate = OxmlElement("w:fldChar")
        separate.set(qn("w:fldCharType"), "separate")
        text_run = OxmlElement("w:r")
        text = OxmlElement("w:t")
        text.text = "1"
        text_run.append(text)
        end = OxmlElement("w:fldChar")
        end.set(qn("w:fldCharType"), "end")
        r = paragraph.add_run()
        r._r.extend([begin, instr, separate, text_run, end])
        set_run_font(r, size=9, color=MUTED)
        suffix_run = paragraph.add_run(suffix)
        set_run_font(suffix_run, size=9, color=MUTED)


def configure_styles(doc):
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT_LATIN
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT_LATIN)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT_LATIN)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CJK)
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1

    heading_tokens = {
        1: (16, BLUE, 16, 8),
        2: (13, BLUE, 12, 6),
        3: (12, DARK_BLUE, 8, 4),
    }
    for level, (size, color, before, after) in heading_tokens.items():
        style = styles[f"Heading {level}"]
        style.font.name = FONT_LATIN
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT_LATIN)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT_LATIN)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CJK)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    for style_name in ("List Bullet", "List Number"):
        style = styles[style_name]
        style.font.name = FONT_LATIN
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT_LATIN)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT_LATIN)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CJK)
        style.font.size = Pt(11)
        style.paragraph_format.left_indent = Inches(0.5)
        style.paragraph_format.first_line_indent = Inches(-0.25)
        style.paragraph_format.space_after = Pt(8)
        style.paragraph_format.line_spacing = 1.167

    for style_name in ("List Bullet 2", "List Number 2"):
        if style_name in styles:
            style = styles[style_name]
            style.font.name = FONT_LATIN
            style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CJK)
            style.font.size = Pt(10.5)
            style.paragraph_format.left_indent = Inches(0.75)
            style.paragraph_format.first_line_indent = Inches(-0.25)
            style.paragraph_format.space_after = Pt(6)
            style.paragraph_format.line_spacing = 1.167


def build_architecture_diagram(path):
    width, height = 1800, 960
    image = Image.new("RGB", (width, height), f"#{WHITE}")
    draw = ImageDraw.Draw(image)
    font_path = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
    title_font = ImageFont.truetype(font_path, 46)
    header_font = ImageFont.truetype(font_path, 31)
    body_font = ImageFont.truetype(font_path, 25)
    small_font = ImageFont.truetype(font_path, 21)

    draw.text((70, 42), "汤淡采集 0.3.8 - 最终系统架构", font=title_font, fill=(31, 77, 120))

    def box(x1, y1, x2, y2, title, lines, fill, outline):
        draw.rounded_rectangle((x1, y1, x2, y2), radius=26, fill=fill, outline=outline, width=4)
        draw.text((x1 + 28, y1 + 22), title, font=header_font, fill=outline)
        y = y1 + 78
        for line in lines:
            draw.text((x1 + 30, y), line, font=body_font, fill=(38, 48, 66))
            y += 42

    box(70, 145, 430, 405, "输入入口", ["抖音私聊转发", "单条视频 / 达人主页", "飞书勾选补转"], (244, 247, 251), (46, 116, 181))
    box(550, 135, 1245, 445, "Chrome 扩展", ["内容脚本: 识别页面、解析作品", "Service Worker: 队列、查重、调度", "本地存储: 配置、状态、失败任务"], (232, 238, 245), (31, 77, 120))
    box(1370, 145, 1730, 405, "外部服务", ["抖音详情接口", "飞书多维表格", "阿里云 DashScope"], (244, 247, 251), (46, 116, 181))

    box(160, 595, 570, 850, "监控队列", ["消息指纹去重", "先关闭视频，再后台入库", "飞书失败保留重试"], (245, 250, 246), (22, 128, 58))
    box(700, 595, 1110, 850, "转写队列", ["真实视频源优先", "30 秒轮询任务状态", "最多 3 次重试"], (255, 250, 236), (138, 97, 0))
    box(1240, 595, 1640, 850, "飞书数据层", ["按视频链接 Upsert", "状态和逐字稿回填原行", "收集人保持原始归属"], (247, 244, 251), (91, 55, 138))

    def arrow(x1, y1, x2, y2, color=(102, 112, 133)):
        draw.line((x1, y1, x2, y2), fill=color, width=6)
        if abs(x2 - x1) > abs(y2 - y1):
            sign = 1 if x2 > x1 else -1
            pts = [(x2, y2), (x2 - 24 * sign, y2 - 14), (x2 - 24 * sign, y2 + 14)]
        else:
            sign = 1 if y2 > y1 else -1
            pts = [(x2, y2), (x2 - 14, y2 - 24 * sign), (x2 + 14, y2 - 24 * sign)]
        draw.polygon(pts, fill=color)

    arrow(430, 275, 550, 275)
    arrow(1245, 275, 1370, 275)
    arrow(885, 445, 365, 595)
    arrow(900, 445, 905, 595)
    arrow(915, 445, 1440, 595)
    arrow(570, 720, 700, 720)
    arrow(1110, 720, 1240, 720)
    draw.text((510, 492), "异步解耦", font=small_font, fill=(102, 112, 133))
    draw.text((1040, 492), "统一写回", font=small_font, fill=(102, 112, 133))
    image.save(path, quality=95)


def add_cover(doc):
    p = doc.add_paragraph()
    style_paragraph(p, before=18, after=2)
    run = p.add_run("技术复盘 / TECHNICAL RETROSPECTIVE")
    set_run_font(run, size=10.5, bold=True, color=BLUE)

    p = doc.add_paragraph()
    style_paragraph(p, before=4, after=7, line=1.0)
    run = p.add_run("汤淡采集")
    set_run_font(run, size=28, bold=True, color=BLACK)

    p = doc.add_paragraph()
    style_paragraph(p, before=0, after=18, line=1.12)
    run = p.add_run("抖音私聊监控、飞书入库与逐字稿自动化")
    set_run_font(run, size=18, bold=True, color=DARK_BLUE)

    metadata = [
        ("复盘范围", "从独立监控原型到整合版 Chrome 扩展"),
        ("当前版本", "0.3.8"),
        ("系统形态", "本机 Chrome 扩展 + 飞书多维表格 + 阿里云 DashScope"),
        ("文档日期", "2026 年 8 月 9 日"),
        ("安全说明", "本文不包含多维表格授权码、API Key 或 App Secret"),
    ]
    for label, value in metadata:
        p = doc.add_paragraph()
        style_paragraph(p, after=3, line=1.0)
        lead = p.add_run(f"{label}: ")
        set_run_font(lead, size=10.5, bold=True, color=INK)
        body = p.add_run(value)
        set_run_font(body, size=10.5, color=INK)

    rule = doc.add_paragraph()
    style_paragraph(rule, before=14, after=18)
    p_pr = rule._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "14")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), BLUE)
    borders.append(bottom)
    p_pr.append(borders)

    add_callout(
        doc,
        "一句话结论",
        "最终系统把“发现内容、读取作品、写入飞书、按需转写”拆成可恢复的异步链路；页面只负责快速识别和取数，耗时的网络写入与转写交给后台队列，因此连续转发不再卡在上一条视频。",
    )

    add_heading(doc, "阅读导航", 2)
    add_bullets(doc, [
        "第 1-4 节: 项目目标、最终能力和系统架构。",
        "第 5-7 节: 核心数据流、关键问题与版本演进。",
        "第 8-11 节: 状态机制、验收、日常运维和安全边界。",
        "第 12-13 节: 风险、后续路线与模块索引。",
    ])
    doc.add_page_break()


def build_document():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_architecture_diagram(DIAGRAM_PATH)
    doc = Document()
    configure_styles(doc)
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.right_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    header_p = section.header.paragraphs[0]
    header_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    style_paragraph(header_p, after=0)
    run = header_p.add_run("汤淡采集 | 技术复盘")
    set_run_font(run, size=8.5, color=MUTED)
    add_page_field(section.footer.paragraphs[0])

    props = doc.core_properties
    props.title = "汤淡采集：抖音私聊监控、飞书入库与逐字稿自动化技术复盘"
    props.subject = "Chrome 扩展 0.3.8 技术复盘"
    props.author = "汤淡"
    props.last_modified_by = "汤淡"
    props.keywords = "抖音, 飞书多维表格, Chrome 扩展, DashScope, 逐字稿"

    add_cover(doc)

    add_heading(doc, "1. 项目背景与目标", 1)
    add_body(doc, "项目最初要解决的是一个非常具体的内容采集动作：在抖音网页端把值得保存的视频转发到指定私聊后，系统自动识别新消息，把视频信息写入飞书多维表格。后来需求逐步扩展到热点宝达人数据、达人主页作品、单条作品、热评、收集人归属，以及阿里云逐字稿。")
    add_body(doc, "这不是单一爬虫，而是一个依赖浏览器登录态、网页交互、第三方 API 和异步任务的本地自动化系统。最终目标可以归纳为四点:")
    add_bullets(doc, [
        "低操作成本: 用户只需要转发、点击同步或在飞书里勾选。",
        "近实时反馈: 私聊新转发快速进入处理流程，页面不被长任务占住。",
        "数据可追踪: 基础信息、来源、收集人、转写状态和最终逐字稿都落在同一行。",
        "失败可恢复: 飞书暂时不可用、扩展重载或转写失败时，任务不会轻易丢失。",
    ])
    add_callout(doc, "设计边界", "当前版本是“本机常开型自动化”，不是云端 7x24 服务。Chrome 必须运行且保持抖音登录；飞书补转复选框由扩展定时扫描，不是飞书服务器主动推送。", fill="FFF8E8", color=AMBER)

    add_heading(doc, "2. 最终交付能力", 1)
    add_heading(doc, "2.1 内容采集入口", 2)
    add_bullets(doc, [
        "指定抖音私聊“AI相关入库”: 只处理本人转发的新视频卡片。",
        "单条抖音视频页: 同步当前作品，不再先翻完整达人主页。",
        "抖音达人主页: 支持按发布日期、最低点赞和排序条件批量同步。",
        "热点宝达人页: 同步达人基础数据、近 30 天指标与粉丝画像。",
        "飞书旧记录: 勾选“转逐字稿”后，为历史视频补建转写任务。",
    ])
    add_heading(doc, "2.2 飞书侧能力", 2)
    add_bullets(doc, [
        "自动定位或创建“竞品达人视频数据”表，并自动补齐缺失字段。",
        "作品按“视频链接”查重并更新；达人按“达人ID”查重。",
        "保存收集人、视频源网址、转写请求、转写状态和完整逐字稿。",
        "支持多维表格个人授权码，也保留开放平台 App ID / Secret 模式。",
    ])
    add_heading(doc, "2.3 逐字稿能力", 2)
    add_bullets(doc, [
        "私聊监控可设置“入库后自动转逐字稿”。",
        "单条视频与主页批量同步可按本次任务选择是否转写。",
        "历史记录可在飞书勾选“转逐字稿”，约 1 分钟内被常开插件接收。",
        "任务使用 DashScope paraformer-v2，状态与结果写回原视频记录。",
    ])

    add_heading(doc, "3. 系统架构", 1)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    run.add_picture(str(DIAGRAM_PATH), width=Inches(6.35))
    doc_pr = run._r.xpath(".//wp:docPr")
    if doc_pr:
        doc_pr[0].set("descr", "汤淡采集系统架构图：输入入口、Chrome 扩展、外部服务、监控队列、转写队列和飞书数据层")
    style_paragraph(p, before=2, after=4)
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_paragraph(cap, after=10)
    run = cap.add_run("图 1  最终系统架构与异步数据流")
    set_run_font(run, size=9, italic=True, color=MUTED)

    add_heading(doc, "3.1 模块职责", 2)
    add_table(doc, ["模块", "主要职责", "关键机制"], [
        ("chat-monitor.js", "维护指定私聊、识别新卡片、可信点击、读取作品并快速关闭视频", "消息指纹、串行处理、播放守卫、互斥维护"),
        ("douhot-extractor.user.js", "热点宝、主页和单条视频的数据提取与页面面板", "接口优先、页面 JSON 合并、DOM 兜底、按次转写选项"),
        ("background.js", "飞书写入、队列、查重、配置、转写调度和失败重试", "MV3 Service Worker、chrome.storage、alarms"),
        ("popup/options", "监控开关、收集人、飞书和阿里云配置", "本机独立配置、状态反馈"),
        ("飞书 Base", "长期数据存储和人工触发补转", "视频链接 Upsert、复选框触发、原行回填"),
    ], [1700, 4200, 3460])

    add_heading(doc, "4. 四条核心工作流", 1)
    add_heading(doc, "4.1 私聊转发 -> 飞书", 2)
    add_numbered(doc, [
        "专用监控页只在 URL 含 dycollector=tangdan 时启动，避免与普通抖音页或旧监控器互相干扰。",
        "内容脚本打开消息面板并确认当前会话严格匹配“AI相关入库”。",
        "扫描本人发送的视频卡片，对作者与缩略图生成消息指纹，并用时间标签过滤旧消息。",
        "通过 Chrome Debugger 发送可信点击，打开视频并取得 aweme_id、作者、互动数据、发布日期和播放源。",
        "一旦取得作品 ID 和 DOM 兜底信息，立即暂停并关闭视频；飞书写入转交后台队列。",
        "后台按视频链接 Upsert 到“竞品达人视频数据”，成功后更新状态和扩展角标。",
    ])
    add_callout(doc, "关键取舍", "页面交互与网络写入解耦。监控页不等待飞书完成，因此连续转发不会因为第一条网络请求或转写任务而卡住。")

    add_heading(doc, "4.2 新视频立即转写", 2)
    add_numbered(doc, [
        "采集结果带上 transcriptionRequested 标志，并优先保存可供外部服务器访问的媒体地址。",
        "后台先写基础视频信息和“等待转写”状态，再把任务放入本地转写队列。",
        "DashScope 返回 task_id 后，状态改为“转写中”；插件每 30 秒查询一次。",
        "完成后下载转写 JSON，将正文写入“直接转逐字稿”，状态改为“已完成”。",
        "失败任务最多尝试 3 次；最终错误会写入“逐字稿状态”，便于人工定位。",
    ])

    add_heading(doc, "4.3 飞书旧记录勾选补转", 2)
    add_numbered(doc, [
        "用户在历史视频所在行勾选“转逐字稿”。",
        "配置了阿里云 API Key 的常开插件每分钟扫描一次作品表，单轮最多接收 50 条。",
        "插件读取视频链接、标题、博主和原始收集人；若现有“视频源网址”只是作品页，则重新解析真实媒体源。",
        "任务入队成功后取消勾选，写入“等待转写”或“转写任务已在处理中”。",
        "后续沿用同一转写队列，结果继续写回原行，不新建重复记录。",
    ])

    add_heading(doc, "4.4 单条与主页作品同步", 2)
    add_body(doc, "单条视频采用“当前详情优先”策略: 合并当前详情接口、页面 JSON 和可见 DOM；只有完全取不到目标视频时，才使用作者作品列表兜底，并在命中目标作品后立即停止翻页。主页批量同步则继续使用分页读取，并支持筛选、排序、热评和按次转写。")

    add_heading(doc, "5. 飞书数据模型", 1)
    add_body(doc, "系统把“作品基础信息”“转写控制”“转写结果”放在同一张作品表中。这样做的好处是无需额外任务表即可使用，但也要求字段名保持稳定。")
    add_table(doc, ["字段组", "代表字段", "用途"], [
        ("作品标识", "视频链接、作品网址", "查重、定位原记录、构造任务键"),
        ("作品内容", "标题、标签、博主名称、封面", "检索、筛选和内容判断"),
        ("互动指标", "点赞、评论、收藏、分享、前3条热评", "判断内容质量"),
        ("时间与长度", "发布日期、作品时长", "筛选和成本预估"),
        ("归属", "收集人", "多人共用表格时保留原始贡献者"),
        ("媒体源", "视频源网址", "供 DashScope 从公网读取视频"),
        ("转写控制", "转逐字稿", "历史记录人工触发；接收后自动取消"),
        ("转写结果", "逐字稿状态、直接转逐字稿", "展示进度、错误和完整正文"),
    ], [1700, 3400, 4260])
    add_callout(doc, "字段约定", "“视频链接”是业务唯一键；“视频源网址”是机器处理地址，两者不能混用。前者应稳定可访问，后者可能需要重新解析或迁移。", fill="FFF8E8", color=AMBER)

    add_heading(doc, "6. 版本演进与关键改动", 1)
    version_rows = [
        ("0.2.3", "飞书失败重试", "写入失败留在后台队列，不再重复打开视频"),
        ("0.2.4", "监控开关", "弹窗可立即开启或关闭私聊监控"),
        ("0.2.5", "连续转发稳定性", "消息只排队一次；取得 ID 后先关视频再入库"),
        ("0.3.0", "自动逐字稿", "接入 DashScope paraformer-v2 和异步状态回写"),
        ("0.3.1", "结果字段调整", "正文写入“直接转逐字稿”，状态单独记录"),
        ("0.3.2", "监控互斥", "避免高频维护循环反复切换消息面板"),
        ("0.3.3", "真实视频源", "优先 play_addr.uri，修复 /playwm/ 与 403 问题"),
        ("0.3.4", "旧任务迁移", "升级后重解最新转发，修复无法恢复的旧源"),
        ("0.3.5", "收集人", "按设备保存使用者姓名，并在转写回填时保持"),
        ("0.3.6", "单条视频提速", "当前详情优先，作者列表仅作最后兜底"),
        ("0.3.7", "按次转写", "单条与主页批量同步均可选择本次是否转写"),
        ("0.3.8", "飞书补转开关", "历史记录勾选后自动创建转写任务并写回原行"),
    ]
    add_table(doc, ["版本", "主题", "结果"], version_rows, [1200, 2400, 5760])

    add_heading(doc, "7. 关键问题、根因与解决", 1)
    issues = [
        ("两个会话之间跳转", "会话选中判断不够严格，维护循环会重新寻找目标。", "监控状态与目标会话绑定，只有精确匹配“AI相关入库”才扫描；专用 URL 隔离监控页。"),
        ("视频反复播放/暂停，第二条卡在第一条", "页面把视频打开、飞书写入和下一条扫描绑在同一串行流程；失败后旧弹窗仍在。", "取到 ID 后先关视频，飞书写入进入持久队列；下一条开始前强制清理旧弹窗，并用播放守卫持续暂停。"),
        ("Service Worker 无效或 Extension context invalidated", "扩展重载后，旧页面仍运行失效的内容脚本，向已经销毁的上下文发消息。", "扩展重载后必须刷新抖音页面；发送消息增加重试，专用页由后台定期维护。"),
        ("发布日期缺失", "不同抖音数据源字段名和时间单位不统一。", "统一从 create_time 等候选字段读取，将秒或毫秒规范成飞书日期时间值。"),
        ("同步单条却显示读取第 N 页", "单条提取复用了主页作品分页逻辑，即使已有目标详情仍继续找。", "0.3.6 改为当前详情、页面 JSON、DOM 三路合并；只有完全失败才翻作者列表。"),
        ("阿里云任务长时间没有逐字稿", "提交给阿里云的是作品页、带水印 /playwm/ 或短期 CDN 地址，阿里云服务器无法读取并返回 403。", "优先使用 play_addr.uri 构造 /aweme/v1/play/ 地址；旧 403 任务迁移为新策略并重试。"),
        ("历史好内容无法后补逐字稿", "原流程只在采集当下创建转写任务，飞书里没有反向触发入口。", "新增“转逐字稿”复选框和 1 分钟扫描器，读取原行、补解析媒体源、入队后自动取消勾选。"),
        ("多人共用后无法区分贡献者", "转写回写是异步操作，若使用当前设备姓名会覆盖原始归属。", "0.3.5 在采集结果和任务快照中保存收集人，后续写回沿用任务中的原始值。"),
    ]
    for index, (title, cause, fix) in enumerate(issues, 1):
        add_heading(doc, f"7.{index} {title}", 2)
        add_body(doc, f"根因: {cause}", bold_lead="根因:")
        add_body(doc, f"处理: {fix}", bold_lead="处理:")

    add_heading(doc, "8. 状态、队列与恢复机制", 1)
    add_heading(doc, "8.1 监控队列", 2)
    add_bullets(doc, [
        "队列保存在 chrome.storage.local，最多保留 300 条。",
        "任务键优先使用视频链接或 aweme_id，同一视频只排队一次。",
        "飞书成功后再从最新队列中删除，避免并发追加时被旧快照覆盖。",
        "飞书失败时保留任务，由 1 分钟 alarm 继续 drain。",
    ])
    add_heading(doc, "8.2 转写队列", 2)
    add_table(doc, ["状态", "含义", "下一步"], [
        ("queued", "已经接收，尚未提交阿里云", "立即提交；成功后保存 task_id"),
        ("submitted", "阿里云任务进行中", "30 秒后轮询"),
        ("failed", "连续失败达到 3 次", "状态回写飞书；可在重新获得有效源后重试"),
        ("completed", "结果已写回", "从本地队列移除"),
    ], [1500, 3800, 4060], status_col=0)
    add_heading(doc, "8.3 互斥与防重", 2)
    add_body(doc, "监控页面用 scanning、maintaining、processing 和 serial 控制页面级并发；后台分别用 monitorDraining、transcriptionProcessing 和 baseTranscriptionRequestProcessing 控制三类长任务。这个设计避免同一个 300 毫秒扫描周期中重复点击、重复提交或重复扫描飞书。")

    add_heading(doc, "9. 验证与验收结论", 1)
    add_table(doc, ["验证项", "方法", "结论"], [
        ("扩展与脚本语法", "Node 语法检查 + manifest JSON 解析", "通过"),
        ("旧记录补转", "模拟普通作品页 -> 真实媒体源 -> 入队 -> 取消勾选", "通过"),
        ("收集人保持", "旧记录补转任务携带原行收集人", "通过"),
        ("缺少视频链接", "模拟异常记录并检查状态回写", "通过"),
        ("实际阿里云付费任务", "未主动选择真实记录，避免未经确认产生费用", "未执行"),
    ], [2500, 4200, 2660], status_col=2)
    add_callout(doc, "验收口径", "真实环境最终验收仍需在重新加载 0.3.8 后，用一条未入库视频和一条历史未转写记录分别测试。付费转写不应在没有明确选定作品时自动作为开发测试。", fill="FFF8E8", color=AMBER)

    add_heading(doc, "10. 日常使用与运维 SOP", 1)
    add_heading(doc, "10.1 首次或升级后", 2)
    add_numbered(doc, [
        "在 chrome://extensions 重新加载“汤淡采集 | 热点宝 + 私聊监控”，确认版本 0.3.8。",
        "刷新所有已经打开的抖音和热点宝页面，清除旧内容脚本上下文。",
        "在设置页保存自己的飞书授权与阿里云 API Key，并测试飞书连接。",
        "确认收集人、目标私聊“AI相关入库”和自己的抖音昵称正确。",
        "打开专用监控页，观察状态进入“正在监控”。",
    ])
    add_heading(doc, "10.2 历史记录补转", 2)
    add_numbered(doc, [
        "在“竞品达人视频数据”找到需要转写的视频。",
        "勾选“转逐字稿”，不要修改“视频链接”。",
        "等待约 1 分钟；任务被接收后复选框会自动取消。",
        "观察“逐字稿状态”从“等待转写”变为“转写中”，最后变为“已完成”。",
        "在“直接转逐字稿”查看完整文字；失败时按状态提示检查视频源或 API Key。",
    ])
    add_heading(doc, "10.3 常见故障顺序", 2)
    add_bullets(doc, [
        "先确认 Chrome 未退出、电脑未休眠、抖音仍登录。",
        "确认加载的是整合版 0.3.8，而不是旧插件副本。",
        "扩展刚重载时先刷新抖音页面；context invalidated 通常不是业务数据错误。",
        "看弹窗监控状态和扩展角标，再看飞书“逐字稿状态”。",
        "若多台电脑共用同一 Base，只保留一台配置阿里云 Key 作为转写处理机。",
    ])

    add_heading(doc, "11. 安全与权限边界", 1)
    add_bullets(doc, [
        "多维表格个人授权码等同于用户表格权限，应只保存在本机扩展存储，不写入代码、截图、文档或群聊。",
        "阿里云 API Key 只保存在配置它的电脑；视频源会提交给阿里云服务器处理，并产生调用费用。",
        "Chrome Debugger 权限用于可信点击与按键，权限范围较高，插件目录应由可信人员维护。",
        "向朋友分发时，每人使用自己的飞书授权码和收集人；如多人共用同一 Base，应明确唯一转写处理机。",
        "如果授权码或 API Key 曾在聊天中明文发送，应按相应平台流程轮换，避免长期风险。",
        "面向大规模团队或长期生产使用时，应把密钥和外部 API 调用迁移到服务端代理。",
    ])

    add_heading(doc, "12. 已知限制与后续路线", 1)
    add_table(doc, ["方向", "当前限制", "建议"], [
        ("实时性", "私聊发现快，但飞书旧记录补转受 1 分钟 alarm 限制", "如需真正秒级，用飞书自动化或事件订阅调用云端任务服务"),
        ("稳定性", "抖音 DOM 类名和消息布局变化会影响识别", "为关键选择器增加版本探测、日志和回归样例"),
        ("扩展生命周期", "MV3 Service Worker 会休眠，页面重载会使旧上下文失效", "继续保持队列持久化；增加可视化诊断与一键自检"),
        ("多机并发", "多台配置同一 Key 可能同时扫描到同一勾选项", "增加飞书任务锁字段或迁移为中心化转写服务"),
        ("媒体源", "真实播放地址可能受签名、地区、时效和登录态影响", "保存 aweme_id 与来源策略版本，失败时按策略重新解析"),
        ("成本控制", "主页批量转写可能一次产生多条费用", "加入预计时长/费用提示、批量确认和每日额度"),
        ("可观测性", "当前错误分散在状态字段、扩展状态和本地存储", "增加任务日志页，统一展示采集、飞书和转写阶段"),
    ], [1650, 3800, 3910])
    add_callout(doc, "推荐优先级", "下一阶段优先做“一键自检 + 任务日志 + 多机锁”。这三项比继续增加采集入口更能降低日常维护成本。")

    add_heading(doc, "13. 结论", 1)
    add_body(doc, "这次迭代最重要的成果不是新增某一个按钮，而是把一个易卡住的网页脚本改造成了分层、可恢复的本地自动化系统。页面负责快速发现与取数，后台负责持久队列和外部 API，飞书既是结果库也是人工触发界面。")
    add_body(doc, "当前 0.3.8 已覆盖“私聊自动收集、单条/主页同步、收集人归属、新视频即时转写、历史视频勾选补转”的完整闭环。下一阶段如果要支撑更多朋友长期共用，重点应从功能增加转向中心化任务、密钥隔离、并发锁和可观测性。")

    add_heading(doc, "附录 A. 代码与配置索引", 1)
    add_table(doc, ["文件", "作用"], [
        ("manifest.json", "扩展版本、权限、页面匹配与网络访问范围"),
        ("background.js", "飞书 API、字段模型、查重、监控队列、转写队列、定时任务"),
        ("chat-monitor.js", "目标私聊识别、消息扫描、可信交互、视频解析与关闭"),
        ("douhot-extractor.user.js", "热点宝、达人主页、单条作品采集和网页浮动面板"),
        ("popup.html / popup.js", "快速同步、收集人、监控开关和按次转写入口"),
        ("options.html / options.js", "飞书、阿里云、私聊监控等完整设置"),
        ("整合版安装说明.md", "版本演进、安装和运行条件"),
        ("学员使用教程.md", "面向普通使用者的安装与采集步骤"),
    ], [3000, 6360])

    doc.save(OUT_PATH)
    print(OUT_PATH)


if __name__ == "__main__":
    build_document()
