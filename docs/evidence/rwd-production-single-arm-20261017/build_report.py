from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

from PIL import Image
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
OUTPUT = ROOT / "RWD单臂外部对照生产链路测试报告.docx"

FONT_CN = "Noto Sans CJK SC"
FONT_MONO = "Menlo"
INK = "17202A"
MUTED = "4B5563"
NAVY = "183A55"
PALE_BLUE = "EEF4F8"
PALE_GRAY = "F6F7F9"
BORDER = "D9D9D9"
WHITE = "FFFFFF"
TEAL = "0E7490"


def set_run_font(run, name: str = FONT_CN, size: float = 11, color: str = INK, bold=None):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.rFonts
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), name)


def set_cell_shading(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=BORDER, size=6):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        node = borders.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            borders.append(node)
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), str(size))
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), color)


def set_table_fixed_layout(table):
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = tr_pr.find(qn("w:cantSplit"))
    if cant_split is None:
        cant_split = OxmlElement("w:cantSplit")
        tr_pr.append(cant_split)


def repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = tr_pr.find(qn("w:tblHeader"))
    if tbl_header is None:
        tbl_header = OxmlElement("w:tblHeader")
        tr_pr.append(tbl_header)
    tbl_header.set(qn("w:val"), "true")


def clear_cell(cell):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    return p


def write_cell(cell, text: str, *, size=8.8, bold=False, color=INK, align=WD_ALIGN_PARAGRAPH.LEFT, mono=False):
    p = clear_cell(cell)
    p.alignment = align
    p.paragraph_format.line_spacing = 1.12
    lines = str(text).split("\n")
    for idx, line in enumerate(lines):
        run = p.add_run(line)
        set_run_font(run, FONT_MONO if mono else FONT_CN, size, color, bold)
        if idx < len(lines) - 1:
            run.add_break()
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    set_cell_margins(cell)


def add_paragraph(
    doc: Document,
    text: str,
    *,
    size=11,
    color=INK,
    bold=False,
    align=WD_ALIGN_PARAGRAPH.LEFT,
    space_before=0,
    space_after=6,
    line_spacing=1.25,
    keep_with_next=False,
    style=None,
):
    p = doc.add_paragraph(style=style)
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = line_spacing
    p.paragraph_format.keep_with_next = keep_with_next
    run = p.add_run(text)
    set_run_font(run, FONT_CN, size, color, bold)
    return p


def add_bullet(doc: Document, text: str, *, level=0, size=10.8):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.22 + level * 0.22)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.2
    run = p.add_run(text)
    set_run_font(run, FONT_CN, size, INK)
    return p


def add_heading(doc: Document, text: str, level=1):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(7 if level == 1 else 5)
    run = p.add_run(text)
    set_run_font(run, FONT_CN, 18 if level == 1 else 14, "000000", True)
    return p


def add_caption(doc: Document, text: str):
    p = doc.add_paragraph(style="Caption")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run(text)
    set_run_font(run, FONT_CN, 8.8, MUTED)
    return p


def add_data_table(
    doc: Document,
    headers: list[str],
    rows: Iterable[Iterable[str]],
    widths: list[float],
    *,
    font_size=8.5,
    alignments: list = None,
    row_fills: list[str] | None = None,
    first_col_fill: str | None = None,
):
    rows = [list(map(str, row)) for row in rows]
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_fixed_layout(table)
    set_table_borders(table)
    for column, width in zip(table.columns, widths):
        column.width = Inches(width)
    hdr = table.rows[0]
    repeat_header(hdr)
    prevent_row_split(hdr)
    for i, (cell, header, width) in enumerate(zip(hdr.cells, headers, widths)):
        cell.width = Inches(width)
        write_cell(
            cell,
            header,
            size=font_size,
            bold=True,
            color=WHITE,
            align=WD_ALIGN_PARAGRAPH.CENTER,
        )
        set_cell_shading(cell, NAVY)
    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        prevent_row_split(table.rows[-1])
        base_fill = WHITE if r_idx % 2 == 0 else PALE_GRAY
        if row_fills:
            base_fill = row_fills[r_idx]
        for c_idx, (cell, value, width) in enumerate(zip(cells, row, widths)):
            cell.width = Inches(width)
            fill = first_col_fill if c_idx == 0 and first_col_fill else base_fill
            set_cell_shading(cell, fill)
            align = alignments[c_idx] if alignments else (WD_ALIGN_PARAGRAPH.LEFT if c_idx == 0 else WD_ALIGN_PARAGRAPH.CENTER)
            write_cell(cell, value, size=font_size, align=align)
    return table


def add_metadata_table(doc: Document, rows: list[tuple[str, str]], widths=(1.34, 5.16)):
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_fixed_layout(table)
    set_table_borders(table)
    for column, width in zip(table.columns, widths):
        column.width = Inches(width)
    for label, value in rows:
        cells = table.add_row().cells
        prevent_row_split(table.rows[-1])
        cells[0].width = Inches(widths[0])
        cells[1].width = Inches(widths[1])
        set_cell_shading(cells[0], PALE_BLUE)
        set_cell_shading(cells[1], WHITE)
        write_cell(cells[0], label, size=8.8, bold=True, color=NAVY)
        write_cell(cells[1], value, size=8.8, color=INK)
    return table


def add_figure(doc: Document, image_path: Path, caption: str, *, max_width=6.5, max_height=5.3):
    with Image.open(image_path) as im:
        px_w, px_h = im.size
    width = min(max_width, max_height * px_w / px_h)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(1)
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    shape = run.add_picture(str(image_path), width=Inches(width))
    doc_pr = shape._inline.docPr
    doc_pr.set("descr", caption)
    doc_pr.set("title", caption)
    add_caption(doc, caption)


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)
    set_run_font(run, FONT_CN, 8.5, MUTED)


def add_page_break(doc: Document):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.add_run().add_break(WD_BREAK.PAGE)


def style_document(doc: Document):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.62)
    section.bottom_margin = Inches(0.62)
    section.left_margin = Inches(0.67)
    section.right_margin = Inches(0.67)
    section.header_distance = Inches(0.25)
    section.footer_distance = Inches(0.28)
    section.different_first_page_header_footer = True

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT_CN
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    title = styles["Title"]
    title.font.name = FONT_CN
    title.font.size = Pt(30)
    title.font.bold = True
    title.font.color.rgb = RGBColor(0, 0, 0)
    title._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN)
    title.paragraph_format.space_after = Pt(14)
    title_p_pr = title._element.get_or_add_pPr()
    for border in title_p_pr.findall(qn("w:pBdr")):
        title_p_pr.remove(border)

    for level, size in ((1, 18), (2, 14)):
        style = styles[f"Heading {level}"]
        style.font.name = FONT_CN
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(0, 0, 0)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN)

    caption = styles["Caption"]
    caption.font.name = FONT_CN
    caption.font.size = Pt(8.8)
    caption.font.color.rgb = RGBColor.from_string(MUTED)
    caption._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN)

    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run("MedTrust 可信数据空间  |  生产链路测试")
    set_run_font(run, FONT_CN, 8.2, MUTED)

    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    run = p.add_run("RWD 单臂外部对照生产链路测试报告  |  第 ")
    set_run_font(run, FONT_CN, 8.5, MUTED)
    add_page_field(p)
    run = p.add_run(" 页")
    set_run_font(run, FONT_CN, 8.5, MUTED)


def add_cover(doc: Document):
    add_paragraph(doc, "生产验证报告", size=10, color=TEAL, bold=True, space_before=18, space_after=54)
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(12)
    p_p_pr = p._p.get_or_add_pPr()
    for border in p_p_pr.findall(qn("w:pBdr")):
        p_p_pr.remove(border)
    run = p.add_run("RWD 单臂外部对照生产链路测试报告")
    set_run_font(run, FONT_CN, 30, "000000", True)

    add_paragraph(
        doc,
        "生产入口 web.szchada.top 的端到端复测与证据记录",
        size=14,
        color="000000",
        space_after=28,
        line_spacing=1.3,
    )
    add_paragraph(
        doc,
        "本报告记录药企发起、产品级 ACL、合规预审、双院数字合约与签发、可信空间执行、"
        "分层匹配结果发布、回执链核验和终态清理的完整过程。数据为合成数据，结果用于验证平台流程与治理控制，"
        "不用于药物疗效结论。",
        size=11,
        space_after=22,
        line_spacing=1.35,
    )
    add_metadata_table(
        doc,
        [
            ("生产入口", "https://web.szchada.top"),
            ("作业标识", "job-mvcepxot-0113b188"),
            ("最终状态", "PURGED"),
            ("测试日期", "2026-10-17"),
            ("报告版本", "V1.0"),
        ],
    )
    add_paragraph(doc, "编制：MedTrust 生产验证小组", size=9.5, color=MUTED, space_before=22, space_after=2)


def add_executive_summary(doc: Document):
    add_page_break(doc)
    add_heading(doc, "执行结论", 1)
    add_paragraph(
        doc,
        "本轮生产复测完成。药企账号在缺少授权时被拒绝配置作业；补齐两份产品级 ACL、合规预审和双院合约后，"
        "AI 助手成功提交单臂外部对照作业。作业完成分层匹配、TEE 内发布审查、结果返回和终态清理，"
        "全程原始行未离开医院连接器。",
        size=11.2,
        space_after=10,
    )
    add_data_table(
        doc,
        ["检查项", "实际结果", "判断"],
        [
            ["作业终态", "PURGED", "通过"],
            ["六个执行阶段", "全部 SUCCEEDED", "通过"],
            ["匹配规模", "460 例试验组 + 920 例对照组", "通过"],
            ["最小单元格", "minCell=5，抑制 0 格", "通过"],
            ["可信执行", "TDX，TCB 5.1.3，院内连接器核验通过", "通过"],
            ["回执链", "华山连续 4、瑞金连续 4、TEE 节点连续 5", "通过"],
            ["查询预算", "1/5", "通过"],
        ],
        [1.55, 3.55, 0.8],
        font_size=8.8,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
    )
    add_paragraph(doc, "", space_after=2)
    add_heading(doc, "核心结果", 2)
    add_data_table(
        doc,
        ["分层", "试验阳性 / 阴性", "对照阳性 / 阴性", "匹配数", "未匹配"],
        [
            ["18-39 | M", "25 / 105", "101 / 159", "130", "0"],
            ["18-39 | F", "16 / 94", "63 / 157", "110", "0"],
            ["40-64 | M", "22 / 88", "76 / 144", "110", "0"],
            ["40-64 | F", "43 / 67", "73 / 147", "110", "0"],
        ],
        [1.35, 1.25, 1.25, 0.75, 0.7],
        font_size=8.8,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] + [WD_ALIGN_PARAGRAPH.CENTER] * 4,
    )
    add_paragraph(
        doc,
        "匹配采用年龄带与性别四个分层组合，卡尺 30 天，试验组与对照组匹配比例 2:1。"
        "结果只包含聚合统计，未返回个体级数据，也未加入差分隐私噪声。",
        size=10.3,
        color=MUTED,
        space_before=7,
        space_after=8,
    )
    add_paragraph(
        doc,
        "结果边界：链路的成功说明授权、合约、作业调度、TEE 执行、发布审查、回执和清理能够协同工作。"
        "由于试验组与对照组均为合成数据，本报告不能据此评价药物有效性、安全性或真实世界疗效；"
        "生产上线前仍需使用经过伦理、数据使用和监管路径确认的真实数据完成进一步验证。",
        size=9.6,
        color=MUTED,
        space_before=3,
        space_after=8,
    )


def add_background(doc: Document):
    add_heading(doc, "场景背景与业务价值", 1)
    add_heading(doc, "单臂试验为什么需要外部对照", 2)
    add_paragraph(
        doc,
        "单臂试验只观察接受试验干预的人群，没有同期的内部随机对照组。对于部分罕见病、严重疾病或伦理上难以设置安慰剂组的场景，"
        "研究团队会考虑使用其他医院的历史真实世界数据构建外部对照。该方法的可行性取决于人群定义、分层匹配、时间窗口、"
        "数据质量和偏倚控制，不能仅凭平台跑通就视为临床证据成立。",
        size=10.8,
    )
    add_paragraph(
        doc,
        "本次验证使用华山医院 460 例试验组合成数据和瑞金医院 5,600 例历史对照合成数据。"
        "双方按年龄带与性别进行分层，在 30 天卡尺内以 2:1 比例匹配。匹配与发布审查在可信空间节点内执行，"
        "平台只返回达到最小单元格阈值的聚合结果。",
        size=10.8,
    )
    add_heading(doc, "业务价值", 2)
    add_bullet(doc, "药企可以用更短的时间评估外部对照的样本可得性，减少对前瞻性对照招募的盲目投入。")
    add_bullet(doc, "医院在本地完成数据准备和签名确认，平台不以业务页面直接暴露原始行。")
    add_bullet(doc, "产品级 ACL、合规预审和数字合约分别控制能不能访问、能不能做、以及以什么条件做。")
    add_bullet(doc, "TEE 证明、院内连接器核验和连续回执链让跨机构执行可以追溯，并在作业结束后清理临时制品。")
    add_heading(doc, "本轮验证目标", 2)
    add_data_table(
        doc,
        ["目标", "验证方式", "通过标准"],
        [
            ["授权先行", "先清空授权与合约，再从零重建", "无 ACL 时 AI 助手拒绝配置作业"],
            ["合规前置", "创建合规组合并执行 L2 裁决", "裁决不是 block 才允许申请合约"],
            ["双院签署", "华山、瑞金分别登录并签发", "两份合约生效且具备 TDX 证明策略"],
            ["受控执行", "通过 AI 助手提交外部对照配置", "作业完成六阶段且结果满足 minCell"],
            ["可核验与可清理", "检查 TDX、回执链、销毁时间", "终态 PURGED 且三方回执链连续"],
        ],
        [1.25, 2.55, 2.7],
        font_size=8.7,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )


def add_environment(doc: Document):
    add_page_break(doc)
    add_heading(doc, "生产环境与测试账号", 1)
    add_paragraph(
        doc,
        "页面入口为 https://web.szchada.top，控制面 API 为 https://api.szchada.top。"
        "本轮所有业务数据均由生产 API 和 ali29 上的生产服务处理，不使用本地隔离测试栈。",
        size=10.7,
    )
    add_heading(doc, "账号与角色", 2)
    add_data_table(
        doc,
        ["角色", "登录账号", "密码", "参与方", "用途"],
        [
            ["药企 PV 研究员", "pv@demo-pharma.example", "demo123456", "pharma-demo", "发起预审、合约和作业"],
            ["华山医院管理员", "admin@huashan-hospital.com", "demo123456", "p-huashan", "签发试验组合约"],
            ["瑞金医院管理员", "admin@rjh.com.cn", "demo123456", "p-ruijin", "签发对照组合约"],
            ["合规账号", "compliance@medtrust.org", "demo123456", "平台合规", "创建组合并执行 L2 裁决"],
            ["空间运营账号", "data-governance@health.gov.cn", "demo123456", "平台运营", "带 TDX 证明策略重新发起 MDOP 要约"],
        ],
        [0.75, 2.15, 0.85, 0.8, 1.95],
        font_size=7.3,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 5,
    )
    add_paragraph(
        doc,
        "上述均为验证环境演示账号。登录截图中的密码按用户要求保留，未作遮挡。",
        size=9.2,
        color=MUTED,
        space_before=6,
    )
    add_page_break(doc)
    add_heading(doc, "关键标识", 1)
    add_data_table(
        doc,
        ["对象", "标识"],
        [
            ["试验组数据产品", "40ff788a-89e7-4601-9981-9b9b962d509e"],
            ["对照组数据产品", "99bd8b08-6a69-457f-8063-2bde919ea413"],
            ["试验组 ACL", "67d57fc6-9466-477e-a599-e9de95d309b5"],
            ["对照组 ACL", "abd9f72f-7ec4-4ac7-97a4-c61f8a8e5a16"],
            ["合规组合", "3b933fb6-db28-4889-8a45-905621cc2fc5"],
            ["合规裁决", "7dcddbda-46ab-4dc5-989c-655a4da7583b"],
            ["试验组合约", "56dc0834-c30b-4970-a7ed-735cebdf8435"],
            ["对照组合约", "f06ce079-4a7e-4608-be78-b57fa3b07e90"],
            ["执行凭证", "tkt-ceb497b7-3d2f-4d2e-8745-fcd251a32f6e"],
            ["作业", "job-mvcepxot-0113b188"],
        ],
        [1.45, 5.05],
        font_size=8.25,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )


def add_chain_overview(doc: Document):
    add_page_break(doc)
    add_heading(doc, "链路与控制点", 1)
    add_paragraph(
        doc,
        "本轮从干净治理状态重新开始。产品访问、合规预审、合约和作业形成前后依赖，任一道门未通过，"
        "后续步骤都不能绕过前一道门。",
        size=10.7,
    )
    add_data_table(
        doc,
        ["顺序", "控制点", "平台行为", "未满足时的结果"],
        [
            ["1", "产品级 ACL", "校验 pharma-demo 对试验与对照产品是否有 catalog、compute 权限", "AI 助手不能生成可提交的任务"],
            ["2", "合规预审", "创建合规组合并执行 L2 裁决", "合约申请没有合规依据"],
            ["3", "数字合约", "药企申请，华山和瑞金分别签发", "无法形成跨院执行授权"],
            ["4", "C2 证明策略", "运营账号按 TDX 证明策略发起 MDOP 要约", "可信空间节点不能接收 C2"],
            ["5", "作业执行", "连接器取数、密封，TEE 匹配与发布审查", "没有执行凭证或作业失败"],
            ["6", "结果交付", "只返回聚合结果，应用 minCell=5", "小单元格被抑制或不发布"],
            ["7", "销毁与审计", "清理临时制品，保留回执链", "作业不能进入合规终态"],
        ],
        [0.55, 1.12, 2.75, 2.08],
        font_size=8.5,
        alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )
    add_page_break(doc)
    add_heading(doc, "后端服务与 Agent 总览", 1)
    add_data_table(
        doc,
        ["组件", "主要职责", "本轮关键动作"],
        [
            ["DataAccessService", "产品级 ACL 的授予、核验与回收", "核验两份产品访问已生效"],
            ["ComplianceService", "合规组合与裁决", "auto_approve，medium risk，k=5"],
            ["ContractService", "合约申请、签发、状态与通知", "生成两份 draft 并推进到 active"],
            ["MdopContractService", "MDOP 条款与 C2 证明策略", "绑定 tee:['tdx'] 证明策略"],
            ["chat-agent / Pi Agent", "自然语言解析、卡片生成与工具调用", "检查授权并调用 submit_external_control"],
            ["MdopController / MdopJobsService", "编译计划、创建作业、记录阶段", "生成 plan_hash、六阶段与工单"],
            ["MdopSchedulerService", "调度与执行凭证推进", "OFFERED -> ISSUED"],
            ["华山/瑞金 connector", "本地取数、密封、签名核验", "src 与 seal 阶段完成"],
            ["tee-node-a", "TDX 内匹配、C3 汇总与发布审查", "external-control + small-cell 脱敏"],
            ["MdopPurgeService", "临时制品销毁", "作业终态 PURGED"],
        ],
        [1.62, 2.45, 2.43],
        font_size=8.2,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )


def step_data():
    pharma = "pv@demo-pharma.example / demo123456"
    huashan = "admin@huashan-hospital.com / demo123456"
    ruijin = "admin@rjh.com.cn / demo123456"
    compliance = "compliance@medtrust.org / demo123456"
    operator = "data-governance@health.gov.cn / demo123456"
    return [
        {
            "file": "01-login-pharma.png",
            "title": "药企研究员登录生产入口",
            "intro": "以数据使用方身份进入生产空间。登录截图完整显示账号与密码，作为本轮测试的起始身份凭据。",
            "action": "在用户登录页输入药企账号和密码，点击登录。",
            "account": pharma,
            "entry": "https://web.szchada.top 用户登录页",
            "service": "控制面认证服务",
            "backend": "校验账号、角色与参与方绑定，签发控制台会话。",
            "result": "登录成功，进入 pharma-demo 的数据使用方视图。",
        },
        {
            "file": "02-space-overview-pharma.png",
            "title": "确认空间总览与当前角色",
            "intro": "空间总览用于确认当前空间、角色和待处理事项。左侧身份显示创新药企 PV 研究员，属于数据使用方。",
            "action": "打开工作台，核对空间为 sh-med 及待办统计。",
            "account": f"{pharma}（当前会话）",
            "entry": "工作台 → 空间总览",
            "service": "Space Overview / Workbench",
            "backend": "汇总数据产品、连接器、任务、通知和角色上下文。",
            "result": "确认当前会话属于药企，无法代替医院管理员签发合约。",
        },
        {
            "file": "03-data-catalog.png",
            "title": "查看数据产品目录",
            "intro": "数据产品目录只展示元数据和访问状态，原始数据路径标注为不出域、仅连接器可见。",
            "action": "进入数据与合约，查看数据产品列表和授权状态。",
            "account": f"{pharma}（当前会话）",
            "entry": "数据与合约 → 数据产品",
            "service": "DataProduct Catalog",
            "backend": "返回产品标题、级别、行数、访问状态和本地路径元数据。",
            "result": "确认试验与对照产品均作为独立数据产品管理。",
        },
        {
            "file": "03a-trial-data-product.png",
            "title": "核对华山试验组数据产品",
            "intro": "试验组产品为单臂试验受试者数据，由华山试点提供，数据行数为 460。",
            "action": "定位并展开华山试验组产品条目。",
            "account": f"{pharma}（当前会话）",
            "entry": "数据与合约 → 数据产品",
            "service": "DataProduct Catalog / ACL",
            "backend": "显示产品 ID、提供方、行数、授权标签和隐藏的本地路径。",
            "result": "试验产品 ID 为 40ff788a-89e7-4601-9981-9b9b962d509e，已授权。",
            "checks": [
                "产品：单臂试验受试者数据（华山试点·合成 460）",
                "提供方：p-huashan；访问状态：已授权",
                "本地路径仅连接器可见，页面不返回原始行",
            ],
        },
        {
            "file": "03b-control-data-product.png",
            "title": "核对瑞金历史对照数据产品",
            "intro": "对照组产品为真实世界历史对照池，由瑞金提供，数据行数为 5,600。",
            "action": "定位并展开瑞金对照组产品条目。",
            "account": f"{pharma}（当前会话）",
            "entry": "数据与合约 → 数据产品",
            "service": "DataProduct Catalog / ACL",
            "backend": "显示产品 ID、提供方、行数、授权标签和隐藏的本地路径。",
            "result": "对照产品 ID 为 99bd8b08-6a69-457f-8063-2bde919ea413，已授权。",
            "checks": [
                "产品：真实世界历史对照池（瑞金·合成 5,600）",
                "提供方：p-ruijin；访问状态：已授权",
                "产品目录只提供元数据，不向药企暴露数据行",
            ],
        },
        {
            "file": "04-connectors-runtime.png",
            "title": "确认连接器页面的角色边界",
            "intro": "药企账号可以查看连接器入口说明，但不能使用医院管理员的连接器视图。页面提示需使用医院账号查看本院节点和任务队列。",
            "action": "打开数据与合约中的本院连接器页面。",
            "account": f"{pharma}（当前会话）",
            "entry": "数据与合约 → 本院连接器",
            "service": "Connector View role guard",
            "backend": "检查角色和数据提供方绑定，拒绝向药企暴露院内任务队列。",
            "result": "角色边界生效，后续医院签发改用华山和瑞金账号。",
        },
        {
            "file": "05-chat-acl-required.png",
            "title": "AI 助手阻止缺少 ACL 的作业配置",
            "intro": "在授权缺失时，AI 助手没有继续生成可提交配置，而是分别指出两份产品缺少访问授权，并给出授权、核验、再回到对话的路径。",
            "action": "在 AI 助手输入“我想做单臂试验的外部对照”。",
            "account": f"{pharma}（当前会话）",
            "entry": "研究与任务 → AI 助手",
            "service": "chat-agent → Pi Agent 工具前置校验 → DataAccessService",
            "backend": "工具调用先检查两个产品的 ACL，缺失时 fail-closed，不创建作业。",
            "result": "授权门有效拦截，避免无权限产品进入配置和提交阶段。",
        },
        {
            "file": "06-acl-granted-evidence.png",
            "title": "核验两份产品级 ACL 已生效",
            "intro": "授权完成后，通过生产核验接口确认 pharma-demo 对两个产品都拥有 catalog 和 compute 权限。",
            "action": "调用授权核验接口并检查两份产品的结果。",
            "account": "产品级 ACL 授权流程；核验主体为 pharma-demo（授权执行账号未在证据界面显示）",
            "entry": "生产 API：GET /api/v1/data-access/check",
            "service": "DataAccessService",
            "backend": "读取产品 ACL 独立授权表，返回 allowed、permissions、grantId 和有效期。",
            "result": "两份产品均 allowed=true，reason=granted；ACL ID 与报告附录一致。",
        },
        {
            "file": "07-compliance-prereview.png",
            "title": "创建合规预审并执行 L2 裁决",
            "intro": "预审组合采用多中心临床研究场景，自动裁决为 auto_approve，整体风险为中，要求联邦能力、部分或更高匿名化以及 k=5。",
            "action": "创建合规组合，随后执行自动裁决。",
            "account": compliance,
            "entry": "合规预审生产 API",
            "service": "ComplianceService",
            "backend": "POST /composition 创建组合；POST /compliance/evaluate/:id 执行规则裁决并生成 rulesDigest。",
            "result": "blockingRulesMatched 与 structuralIssues 均为空，预审可用于合约申请。",
        },
        {
            "file": "08-contract-drafts-consumer.png",
            "title": "药企提交两份数字合约申请",
            "intro": "药企分别请求华山试验产品与瑞金对照产品。合约用途为“对话式任务配置（AI Chat Agent）”，采用仅聚合统计和 minCell=5。",
            "action": "在数字合约页发起申请，并由提供方形成待签发合约。",
            "account": f"{pharma}（当前会话）",
            "entry": "数据与合约 → 数字合约",
            "service": "ContractService / MdopContractService",
            "backend": "POST /contracts/requests 创建 draft，生成提供方要约与待签发记录。",
            "result": "形成两份可签发的合约草稿，并等待医院管理员处理。",
        },
        {
            "file": "09-login-hospital-huashan.png",
            "title": "华山医院管理员登录",
            "intro": "切换到数据提供方账号。登录截图显示华山管理员账号和密码，后续签发动作必须在医院身份下完成。",
            "action": "退出药企会话，使用华山医院管理员账号登录。",
            "account": huashan,
            "entry": "https://web.szchada.top 用户登录页",
            "service": "控制面认证服务",
            "backend": "认证医院管理员并绑定 p-huashan 参与方身份。",
            "result": "进入华山医院数据提供方视图。",
        },
        {
            "file": "10-contract-trial-pending-huashan.png",
            "title": "华山查看试验组合约待签发",
            "intro": "华山在待签发合约中看到药企申请，参与方为 pharma-demo → p-huashan，产品为华山试验组数据。",
            "action": "核对试验产品 ID、用途、保留期和 minCell。",
            "account": f"{huashan}（当前会话）",
            "entry": "工作台 / 数字合约 → 待本院签发",
            "service": "ContractService",
            "backend": "按提供方过滤 draft，返回签发、驳回和待审批入口。",
            "result": "确认申请内容与测试用途一致，可进入签发。",
            "checks": [
                "申请方 → 提供方：pharma-demo → p-huashan",
                "产品：40ff788a-89e7-4601-9981-9b9b962d509e",
                "条款：作业完成后保留 30 天、仅聚合统计、minCell=5",
            ],
        },
        {
            "file": "11-contract-trial-active-huashan.png",
            "title": "华山签发试验组合约",
            "intro": "医院页面执行签发后，合约进入生效状态。页面同时显示 C2 证明策略已声明，并允许按 TDX 证明重新发起 MDOP 要约。",
            "action": "点击签发并核对合约生效状态。",
            "account": huashan,
            "entry": "工作台 / 数字合约 → 待本院签发",
            "service": "ContractService + 华山 connector 本地确认",
            "backend": "POST /contracts/:id/approve；连接器本地确认合约并使用 SM2 签名。",
            "result": "试验组合约 56dc0834-c30b-4970-a7ed-735cebdf8435 生效。",
        },
        {
            "file": "12-login-hospital-ruijin.png",
            "title": "瑞金医院管理员登录",
            "intro": "试验组合约完成后，切换到瑞金账号处理对照组合约。登录截图显示瑞金管理员账号和密码。",
            "action": "退出华山会话，使用瑞金医院管理员账号登录。",
            "account": ruijin,
            "entry": "https://web.szchada.top 用户登录页",
            "service": "控制面认证服务",
            "backend": "认证医院管理员并绑定 p-ruijin 参与方身份。",
            "result": "进入瑞金医院数据提供方视图。",
        },
        {
            "file": "13-contract-control-pending-ruijin.png",
            "title": "瑞金查看对照组合约待签发",
            "intro": "瑞金看到 pharma-demo → p-ruijin 的对照合约，产品为瑞金真实世界历史对照池。",
            "action": "核对产品 ID、用途、保留期和输出限制。",
            "account": f"{ruijin}（当前会话）",
            "entry": "工作台 / 数字合约 → 待本院签发",
            "service": "ContractService",
            "backend": "按 p-ruijin 过滤 draft，返回待签发合约与条款摘要。",
            "result": "确认申请与合成对照组用途一致，可进入签发。",
            "checks": [
                "申请方 → 提供方：pharma-demo → p-ruijin",
                "产品：99bd8b08-6a69-457f-8063-2bde919ea413",
                "条款：作业完成后保留 30 天、仅聚合统计、minCell=5",
            ],
        },
        {
            "file": "14-contract-control-active-ruijin.png",
            "title": "瑞金签发对照组合约",
            "intro": "瑞金签发后，对照组合约生效。两家医院分别持有一份本地可执行的合约副本。",
            "action": "点击签发并检查生效状态及 C2 条款。",
            "account": ruijin,
            "entry": "工作台 / 数字合约 → 待本院签发",
            "service": "ContractService + 瑞金 connector 本地确认",
            "backend": "POST /contracts/:id/approve；瑞金连接器本地确认并使用 SM2 签名。",
            "result": "对照组合约 f06ce079-4a7e-4608-be78-b57fa3b07e90 生效。",
        },
        {
            "file": "15a-contract-trial-mdop-active.png",
            "title": "为试验组合约带 TDX 策略重新发起要约",
            "intro": "空间运营账号按已声明的可信空间节点条款重新发起 MDOP 要约，证明策略为 tee:['tdx']，最低可信基为 tdx=5.1.3。",
            "action": "勾选 Intel TDX 与数据密文出域确认，触发带证明策略的 MDOP 要约。",
            "account": operator,
            "entry": "数字合约 → 试验组合约条款",
            "service": "MdopContractService",
            "backend": "POST /contracts/:id/mdop/offer，写入证明策略并推进合约供需状态。",
            "result": "试验组合约具备 TDX 证明策略，可在可信空间节点接收 C2。",
            "checks": [
                "C2 接收节点：tee-node-a",
                "证明策略：tee:['tdx']；最低可信基：tdx=5.1.3",
                "密文出域不等于原始数据仍留在医院，合规属性为委托处理/数据出域",
            ],
        },
        {
            "file": "15b-contract-control-mdop-active.png",
            "title": "为对照组合约带 TDX 策略重新发起要约",
            "intro": "对照组采用同一证明策略。平台明确提示密文出域不等于数据仍在医院，信任锚包括 CPU 证明、代码度量、节点运营方和密钥释放策略。",
            "action": "对瑞金合约勾选 Intel TDX 并确认密文出域条件。",
            "account": operator,
            "entry": "数字合约 → 对照组合约条款",
            "service": "MdopContractService",
            "backend": "写回对照组合约证明策略，配置最低可信基和安全能力。",
            "result": "两份合约都允许 tee-node-a 在 TDX 环境中执行 C2。",
            "checks": [
                "C2 接收节点：tee-node-a",
                "证明策略：tee:['tdx']；最低可信基：tdx=5.1.3",
                "院内连接器仍负责本地核验与合约副本执行",
            ],
        },
        {
            "file": "16-chat-form-empty.png",
            "title": "AI 助手返回外部对照参数卡片",
            "intro": "回到药企账号，AI 助手根据自然语言需求生成结构化参数卡片。卡片要求选择试验方、对照方、产品、执行节点、分层键、卡尺和比例。",
            "action": "提出单臂外部对照需求，等待参数卡片出现。",
            "account": f"{pharma}（药企会话）",
            "entry": "研究与任务 → AI 助手",
            "service": "chat-agent / Pi Agent 工具 submit_external_control",
            "backend": "解析意图、索取结构化参数，并生成可编辑参数卡片。",
            "result": "页面展示完整必填项与默认值，避免直接提交不完整作业。",
        },
        {
            "file": "17-chat-form-filled.png",
            "title": "填写单臂外部对照参数",
            "intro": "试验方选择 p-huashan，对照方选择 p-ruijin；分层为四个年龄与性别组合，卡尺 30 天，匹配比例 2:1。",
            "action": "选择产品、执行节点并填写分层键、卡尺和匹配比例。",
            "account": f"{pharma}（药企会话）",
            "entry": "研究与任务 → AI 助手 → 参数配置卡片",
            "service": "chat-agent / Pi Agent",
            "backend": "校验字段类型、参与方和产品选择，准备调用作业创建工具。",
            "result": "参数与授权产品一致，可以提交。",
        },
        {
            "file": "18-job-submitted.png",
            "title": "提交外部对照作业",
            "intro": "提交后，AI 助手显示任务已提交，并在对话区域返回作业标识、模板、阶段数与合约信息。",
            "action": "点击发送，提交参数卡片。",
            "account": pharma,
            "entry": "研究与任务 → AI 助手",
            "service": "chat-agent → MdopController",
            "backend": "调用 submit_external_control，创建 MDOP 作业与初始阶段。",
            "result": "作业 job-mvcepxot-0113b188 创建，初始状态 SUBMITTED。",
        },
        {
            "file": "18b-job-submitted-status-card.png",
            "title": "核验确定性状态卡显示合约标识",
            "intro": "状态卡以稳定字段展示 jobId、status、template、stages、contractId 和 contractIds。主合约与两份合约列表均可直接追溯。",
            "action": "查看对话中的任务状态卡。",
            "account": f"{pharma}（药企会话）",
            "entry": "AI 助手 → 任务状态卡",
            "service": "chat-agent 状态卡序列化",
            "backend": "将作业状态映射为确定性卡片，不依赖自由文本重新生成。",
            "result": "contractId=56dc0834...，contractIds 同时包含两份合约，证据字段完整。",
            "checks": [
                "jobId=job-mvcepxot-0113b188；status=SUBMITTED",
                "template=rws.external-control；stages=6",
                "contractId=56dc0834-c30b-4970-a7ed-735cebdf8435",
                "contractIds=56dc0834-...；f06ce079-4a7e-4608-be78-b57fa3b07e90",
            ],
        },
        {
            "file": "19-job-negotiating.png",
            "title": "作业进入 NEGOTIATING 并生成执行凭证",
            "intro": "作业详情展示六个阶段、各节点片段哈希、带 TDX 的能力声明和 OFFERED 执行凭证。此时各阶段仍为 PENDING。",
            "action": "打开作业详情，检查计划哈希、节点和工单。",
            "account": f"{pharma}（药企会话）",
            "entry": "研究与任务 → 编排任务 → 作业详情",
            "service": "MdopJobsService / MdopSchedulerService",
            "backend": "编译执行图、计算 plan_hash、生成 tkt-ceb497b7-... 并进入要约阶段。",
            "result": "计划哈希为 sm3:fa09d16e...，三个节点各有独立片段哈希。",
        },
        {
            "file": "20-job-running.png",
            "title": "双院连接器拉取并执行来源阶段",
            "intro": "执行凭证从 OFFERED 推进到 ISSUED。华山与瑞金的 src 阶段开始运行，尝试次数为 1。",
            "action": "观察作业阶段状态与回执链。",
            "account": f"{pharma}（药企会话，查看作业）",
            "entry": "作业详情 job-mvcepxot-0113b188",
            "service": "MdopSchedulerService + 华山/瑞金 connector",
            "backend": "医院连接器出站拉取任务、读取本地产品并在本地形成来源结果。",
            "result": "作业 RUNNING，来源阶段已启动，回执链开始增长。",
        },
        {
            "file": "21-job-result.png",
            "title": "作业完成并返回外部对照聚合结果",
            "intro": "六个阶段全部成功。作业结果包含四层聚合表、minCell=5、未加噪声明、TDX 机器码度量、两院核验结论和连续回执链。",
            "action": "等待作业完成，核对阶段、证明、结果和回执。",
            "account": f"{pharma}（药企会话，查看作业）",
            "entry": "作业详情 → 结果与证据",
            "service": "tee-node-a + external-control C3 collector",
            "backend": "完成 TEE 内匹配、汇总和发布审查，再由控制面接收聚合结果。",
            "result": "作业 SUCCEEDED；四层结果完整，抑制 0 格，TDX TCB 5.1.3。",
        },
        {
            "file": "22-job-purged.png",
            "title": "作业完成销毁并进入 PURGED 终态",
            "intro": "临时制品清理后，作业状态为 PURGED。阶段记录、结果证据和回执链仍可用于审计，但临时计算材料不再保留。",
            "action": "查看终态、销毁时间与审计回执。",
            "account": f"{pharma}（药企会话，查看作业）",
            "entry": "作业详情 job-mvcepxot-0113b188",
            "service": "MdopPurgeService",
            "backend": "销毁临时制品，保留阶段状态、C3 结果摘要和连续回执证明。",
            "result": "销毁时间 2026-10-17T13:05:41.590Z；作业最终 PURGED。",
        },
        {
            "file": "23-task-list-purged.png",
            "title": "在编排任务列表核验终态",
            "intro": "任务列表保留本轮作业并显示 PURGED 标签，便于从业务入口复查终态，而不是只在单条详情页可见。",
            "action": "返回编排任务列表，查找本轮 jobId。",
            "account": f"{pharma}（药企会话）",
            "entry": "研究与任务 → 编排任务",
            "service": "MdopJobsService 列表接口",
            "backend": "按空间和角色聚合作业状态、用途、时间和终态标签。",
            "result": "job-mvcepxot-0113b188 出现在任务列表，用途与 PURGED 状态一致。",
        },
        {
            "file": "24-result-data-evidence.png",
            "title": "汇总生产结果与控制面证据",
            "intro": "结果证据页把终态、plan_hash、TDX、minCell、三方回执链和四层匹配计数集中在一页，便于复核。",
            "action": "核对结果摘要与控制面证据。",
            "account": "证据汇总输出；数据主体来自 pharma-demo 作业",
            "entry": "生产作业证据视图",
            "service": "Result Interpreter / C3 facts",
            "backend": "标准化聚合结果、证明字段和回执状态，生成可核验摘要。",
            "result": "460 例试验组与 920 例对照组匹配，未匹配数为 0。",
        },
        {
            "file": "25-hospital-notifications.png",
            "title": "华山医院接收合约与处理通知",
            "intro": "华山管理员的空间总览显示待处理通知和合约申请。最新通知包含试验组合约 ID，证明提供方能够在自己的业务入口追踪申请与处理状态。",
            "action": "以华山管理员身份查看工作台通知。",
            "account": huashan,
            "entry": "工作台 → 空间总览 → 待处理通知",
            "service": "Contract Notifications",
            "backend": "生成合约申请和自动推进通知，按参与方投递并保留时间戳。",
            "result": "华山可见 56dc0834-c30b-4970-a7ed-735cebdf8435 的申请与后续处理记录。",
        },
    ]


def add_steps(doc: Document):
    add_page_break(doc)
    add_heading(doc, "端到端生产测试步骤", 1)
    add_paragraph(
        doc,
        "以下按实际操作顺序列出 29 张证据截图。每个步骤同时说明页面动作、登录身份、入口、后台服务或 Agent、"
        "后台动作以及作用与结果。截图内容保持生产环境的原始状态。",
        size=10.4,
        color=MUTED,
        space_after=8,
    )
    add_data_table(
        doc,
        ["证据区间", "步骤", "验证内容"],
        [
            ["权限与合规准备", "01-09", "药企身份、产品目录、角色边界、ACL、合规预审"],
            ["双院合约与证明策略", "10-18", "两份申请、双院签发、C2 与 TDX 证明策略"],
            ["作业配置与提交", "19-22", "参数卡片、提交状态和确定性合约字段"],
            ["执行、结果与销毁", "23-27", "执行凭证、连接器取数、TDX 结果、PURGED"],
            ["结果复核与通知", "28-29", "控制面证据汇总和医院侧通知留痕"],
        ],
        [1.48, 0.85, 4.15],
        font_size=8.8,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )
    add_paragraph(
        doc,
        "每一步先列出操作与责任主体，再给出截图。截图中的深色区域是生产控制台，浅色区域是生产 API 或证据汇总视图。",
        size=9.2,
        color=MUTED,
        space_before=7,
        space_after=8,
    )
    for idx, item in enumerate(step_data(), start=1):
        add_page_break(doc)
        add_heading(doc, f"{idx:02d}  {item['title']}", 1)
        add_paragraph(doc, item["intro"], size=10.4, space_after=7)
        add_metadata_table(
            doc,
            [
                ("页面操作", item["action"]),
                ("登录账号 / 密码", item["account"]),
                ("入口", item["entry"]),
                ("后台服务 / Agent", item["service"]),
                ("后台动作", item["backend"]),
                ("作用与结果", item["result"]),
            ],
        )
        if item.get("checks"):
            add_paragraph(doc, "现场核对", size=9.2, color=TEAL, bold=True, space_before=5, space_after=2)
            for check in item["checks"]:
                add_bullet(doc, check, size=8.6)
        image_path = SHOTS / item["file"]
        add_figure(
            doc,
            image_path,
            f"图 {idx}  {item['title']}（{item['file']}）",
            max_width=6.42,
            max_height=4.78 if idx in (19, 20, 21, 22) else 5.05,
        )


def add_final_summary(doc: Document):
    add_page_break(doc)
    add_heading(doc, "结果、价值与限制", 1)
    add_heading(doc, "生产验证结果", 2)
    add_paragraph(
        doc,
        "本轮复测验证了从药企需求到跨院结果交付的完整生产链条。授权缺失时 AI 助手没有绕过控制面；"
        "补齐授权、合规预审和双院合约后，作业按预期完成。TDX 证明、院内连接器核验、六阶段执行、"
        "最小单元格发布审查、连续回执链和终态销毁均有页面证据。",
        size=10.8,
    )
    add_data_table(
        doc,
        ["证据维度", "核验结果", "业务含义"],
        [
            ["产品级 ACL", "两份产品 allowed=true", "药企只获得明确授予的产品权限"],
            ["合规预审", "auto_approve，medium risk，k=5", "合约申请具备结构化合规依据"],
            ["合约与签发", "华山、瑞金分别签发并本地确认", "两家数据提供方保留独立决定权"],
            ["可信执行", "TDX TCB 5.1.3，院内核验通过", "执行环境与注册度量可被持有方核验"],
            ["结果发布", "4 行，minCell=5，抑制 0 格", "只返回满足阈值要求的聚合结果"],
            ["生命周期", "SUCCEEDED → PURGED", "临时计算材料被清理，审计证据保留"],
        ],
        [1.45, 2.25, 2.8],
        font_size=8.5,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )
    add_heading(doc, "限制与后续工作", 2)
    add_bullet(doc, "本轮数据为合成数据，不能用于评价药物疗效、安全性或形成真实世界证据结论。")
    add_bullet(doc, "TDX 证明只能说明已验证的执行环境与代码度量；内存访问模式侧信道不在本轮证明范围内。")
    add_bullet(doc, "minCell=5 降低小单元格泄露风险，但不能单独替代完整的统计披露控制和伦理审查。")
    add_bullet(doc, "页面截图为应对 Cloudflare 偶发超时，通过 ali29 到生产 nginx 的 SSH 隧道采集；业务 API 仍指向 https://api.szchada.top。")
    add_bullet(doc, "下一阶段应使用经批准的真实研究数据，补充偏倚评估、缺失数据处理、敏感性分析、监管路径和药物流行病学审查。")

    add_page_break(doc)
    add_heading(doc, "业务价值与最终判断", 1)
    add_heading(doc, "对业务的直接价值", 2)
    add_paragraph(
        doc,
        "对药企而言，外部对照的可行性可以在正式研究启动前完成数据可得性、匹配规模和合约条件评估。"
        "对医院而言，产品级 ACL、合规裁决和数字合约把数据用途、计算方式、输出限制和保留时间写入可审计条款，"
        "而不是依赖一次性人工批准。对平台运营而言，AI 助手把复杂的配置流程转成结构化卡片，"
        "同时由确定性的工具和控制面继续承担权限检查、作业调度和证据生成。",
        size=10.8,
    )
    add_paragraph(
        doc,
        "从协作效率看，460 例试验组与 920 例对照组的匹配结果在一次受控作业中形成，"
        "受试产品、数据持有方、执行节点和输出阈值均有可追溯标识。研究者可以在进入正式方案设计前，"
        "据此判断样本量、分层可得性和跨院协作条件，而不必先完成对照组的实体招募。",
        size=10.8,
    )
    add_heading(doc, "最终判断", 2)
    add_paragraph(
        doc,
        "本轮生产链路的单臂外部对照测试通过。平台能够在明确的授权和合约边界内完成跨院匹配、可信执行、"
        "聚合结果交付和终态清理，AI 助手的状态卡也能稳定显示 contractId 与 contractIds。"
        "该结论限定为平台工程和生产治理验证，不外推为临床有效性结论。",
        size=11,
        space_after=8,
    )


def add_appendix(doc: Document):
    add_page_break(doc)
    add_heading(doc, "附录 A  六阶段执行记录", 1)
    add_data_table(
        doc,
        ["阶段", "节点", "算子", "作用", "结果"],
        [
            ["src_p_huashan", "p-huashan", "source.dataset@1.0.0", "华山连接器读取本地试验数据", "SUCCEEDED"],
            ["src_p_ruijin", "p-ruijin", "source.dataset@1.0.0", "瑞金连接器读取本地对照数据", "SUCCEEDED"],
            ["seal_p_huashan", "p-huashan", "seal.envelope@1.0.0", "密封试验来源结果", "SUCCEEDED"],
            ["seal_p_ruijin", "p-ruijin", "seal.envelope@1.0.0", "密封对照来源结果", "SUCCEEDED"],
            ["extCtl", "tee-node-a", "rws.external-control@1.0.0", "执行分层与 2:1 匹配", "SUCCEEDED"],
            ["decTee", "tee-node-a", "declassify.small_cell@1.0.0", "执行 minCell=5 发布审查", "SUCCEEDED"],
        ],
        [1.12, 0.8, 1.62, 1.96, 1.0],
        font_size=8.1,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
    )
    add_heading(doc, "附录 B  作业核验摘要", 2)
    add_metadata_table(
        doc,
        [
            ("jobId", "job-mvcepxot-0113b188"),
            ("最终状态", "PURGED"),
            ("plan_hash", "sm3:fa09d16ed029d81d2547bc71a0df2650c9b5d657579684a7bb7201fd407e9a9f"),
            ("执行凭证", "tkt-ceb497b7-3d2f-4d2e-8745-fcd251a32f6e"),
            ("TDX TCB", "5.1.3"),
            ("TDX measurement", "sm3:14761963d7d7a1999ade127e7451951e8dd93fc094070537f26ad7990f9a2ce2"),
            ("查询预算", "1 / 5"),
            ("发布审查", "minCell=5；抑制 0 格；未加差分隐私噪声"),
            ("回执链", "p-huashan 连续 4；p-ruijin 连续 4；tee-node-a 连续 5"),
            ("销毁时间", "2026-10-17T13:05:41.590Z"),
        ],
    )
    add_page_break(doc)
    add_heading(doc, "附录 C  截图清单", 2)
    files = sorted(p.name for p in SHOTS.glob("*.png"))
    rows = []
    left_count = 15
    for i in range(left_count):
        left = files[i] if i < len(files) else ""
        right_idx = i + left_count
        right = files[right_idx] if right_idx < len(files) else ""
        rows.append([
            str(i + 1),
            left,
            str(right_idx + 1) if right else "",
            right,
        ])
    add_data_table(
        doc,
        ["序号", "证据文件", "序号", "证据文件"],
        rows,
        [0.45, 2.86, 0.45, 2.86],
        font_size=7.9,
        alignments=[
            WD_ALIGN_PARAGRAPH.CENTER,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.CENTER,
            WD_ALIGN_PARAGRAPH.LEFT,
        ],
    )


def add_core_properties(doc: Document):
    props = doc.core_properties
    props.title = "RWD 单臂外部对照生产链路测试报告"
    props.subject = "MedTrust 生产入口端到端复测与证据记录"
    props.author = "MedTrust 生产验证小组"
    props.keywords = "RWD, 单臂试验, 外部对照, MDOP, TDX, ACL, 合规预审, 数字合约"
    props.comments = "生产链路测试报告，数据为合成数据。"
    props.created = datetime(2026, 10, 17, 9, 0, 0)
    props.modified = datetime(2026, 10, 17, 17, 0, 0)


def main():
    if not SHOTS.exists():
        raise SystemExit(f"截图目录不存在: {SHOTS}")
    missing = [item["file"] for item in step_data() if not (SHOTS / item["file"]).exists()]
    if missing:
        raise SystemExit(f"缺少截图: {missing}")

    doc = Document()
    style_document(doc)
    add_core_properties(doc)
    add_cover(doc)
    add_executive_summary(doc)
    add_background(doc)
    add_environment(doc)
    add_chain_overview(doc)
    add_steps(doc)
    add_final_summary(doc)
    add_appendix(doc)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
