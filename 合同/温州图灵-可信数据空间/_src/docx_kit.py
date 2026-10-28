# -*- coding: utf-8 -*-
"""中文合同 DOCX 排版工具（python-docx）。

只做三件事：稳定的中文字体/行距、条款级排版、可跨页的表格。
"""
from __future__ import annotations

import re
from typing import Iterable, Sequence

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BODY_FONT = "宋体"
HEAD_FONT = "黑体"
LATIN_FONT = "Times New Roman"
BODY_SIZE = 12  # 小四
TABLE_SIZE = 9.5
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x55, 0x55, 0x55)


def _set_run_font(run, east_asia: str = BODY_FONT, size: float = BODY_SIZE,
                  bold: bool = False, color: RGBColor = INK, italic: bool = False):
    run.font.name = LATIN_FONT
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), LATIN_FONT)
    rfonts.set(qn("w:hAnsi"), LATIN_FONT)
    rfonts.set(qn("w:eastAsia"), east_asia)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color


def _add_rich_text(paragraph, text: str, size: float = BODY_SIZE,
                   east_asia: str = BODY_FONT, color: RGBColor = INK):
    """支持 **加粗** 的行内标记。"""
    parts = re.split(r"(\*\*.+?\*\*)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            _set_run_font(run, east_asia=east_asia, size=size, bold=True, color=color)
        else:
            run = paragraph.add_run(part)
            _set_run_font(run, east_asia=east_asia, size=size, color=color)


def _shade(cell, hex_fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def _cell_margins(table, top=80, bottom=80, left=100, right=100):
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for tag, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        node = OxmlElement(f"w:{tag}")
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tbl_pr.append(mar)


def _repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def _cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    node = OxmlElement("w:cantSplit")
    node.set(qn("w:val"), "true")
    tr_pr.append(node)


def _set_table_width(table, pct: int = 100):
    tbl_pr = table._tbl.tblPr
    width = OxmlElement("w:tblW")
    width.set(qn("w:w"), str(int(pct * 50)))
    width.set(qn("w:type"), "pct")
    tbl_pr.append(width)


def _set_fixed_layout(table, widths: Sequence[float]):
    """固定列宽：同时写 tblLayout 与 tblGrid，Word/LibreOffice 才会一致。"""
    tbl_pr = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tbl_pr.append(layout)
    grid = table._tbl.tblGrid
    cols = grid.findall(qn("w:gridCol"))
    for i, width_cm in enumerate(widths):
        if i < len(cols):
            cols[i].set(qn("w:w"), str(int(width_cm * 567)))


def _para_border_bottom(paragraph, color="999999", size=6):
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


class ContractDoc:
    def __init__(self, header_text: str = "", footer_note: str = ""):
        self.doc = Document()
        self.header_text = header_text
        self.footer_note = footer_note
        self._setup_styles()
        self._setup_page(self.doc.sections[0])
        self._body_started = False

    # ---------- setup ----------
    def _setup_styles(self):
        style = self.doc.styles["Normal"]
        style.font.name = LATIN_FONT
        style.font.size = Pt(BODY_SIZE)
        style.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
        fmt = style.paragraph_format
        fmt.line_spacing = 1.5
        fmt.space_before = Pt(0)
        fmt.space_after = Pt(0)

    @staticmethod
    def _setup_page(section):
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.0)
        section.right_margin = Cm(3.0)
        section.header_distance = Cm(1.3)
        section.footer_distance = Cm(1.3)

    def start_body(self):
        """封面之后另起一节，并挂页眉页脚。"""
        if self._body_started:
            return
        section = self.doc.add_section(WD_SECTION.NEW_PAGE)
        self._setup_page(section)
        section.header.is_linked_to_previous = False
        section.footer.is_linked_to_previous = False

        hp = section.header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hp.paragraph_format.space_after = Pt(0)
        run = hp.add_run(self.header_text)
        _set_run_font(run, east_asia=BODY_FONT, size=8.5, color=MUTED)
        _para_border_bottom(hp)

        fp = section.footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fp.paragraph_format.space_after = Pt(0)
        r1 = fp.add_run("第 ")
        _set_run_font(r1, size=8.5, color=MUTED)
        self._add_field(fp, "PAGE")
        r2 = fp.add_run(" 页  共 ")
        _set_run_font(r2, size=8.5, color=MUTED)
        self._add_field(fp, "NUMPAGES")
        r3 = fp.add_run(" 页")
        _set_run_font(r3, size=8.5, color=MUTED)
        if self.footer_note:
            r4 = fp.add_run("    " + self.footer_note)
            _set_run_font(r4, size=8.5, color=MUTED)
        self._body_started = True

    @staticmethod
    def _add_field(paragraph, field: str):
        run = paragraph.add_run()
        _set_run_font(run, size=8.5, color=MUTED)
        begin = OxmlElement("w:fldChar")
        begin.set(qn("w:fldCharType"), "begin")
        instr = OxmlElement("w:instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = f" {field} "
        sep = OxmlElement("w:fldChar")
        sep.set(qn("w:fldCharType"), "separate")
        text = OxmlElement("w:t")
        text.text = "1"
        end = OxmlElement("w:fldChar")
        end.set(qn("w:fldCharType"), "end")
        run._r.append(begin)
        run._r.append(instr)
        run._r.append(sep)
        run._r.append(text)
        run._r.append(end)

    # ---------- cover ----------
    def cover(self, kicker: str, title_lines: Sequence[str], subtitle: str = "",
              meta_lines: Sequence[str] = (), doc_no: str = ""):
        if doc_no:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            p.paragraph_format.space_before = Pt(6)
            _add_rich_text(p, doc_no, size=10.5, color=MUTED)

        for _ in range(4):
            self.doc.add_paragraph()

        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(10)
        _add_rich_text(p, kicker, size=13, east_asia=HEAD_FONT, color=MUTED)

        for i, line in enumerate(title_lines):
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(4 if i else 0)
            p.paragraph_format.space_after = Pt(4)
            _add_rich_text(p, line, size=27, east_asia=HEAD_FONT, color=INK)

        if subtitle:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(12)
            _add_rich_text(p, subtitle, size=13, color=MUTED)

        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(22)
        p.paragraph_format.space_after = Pt(26)
        _add_rich_text(p, "—" * 18, size=10, color=MUTED)

        for line in meta_lines:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            _add_rich_text(p, line, size=13)

        for _ in range(3):
            self.doc.add_paragraph()

        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _add_rich_text(p, "本文件经双方签字盖章后生效", size=9, color=MUTED)

    # ---------- blocks ----------
    def h1(self, text: str, page_break: bool = False):
        if page_break:
            self.page_break()
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        _add_rich_text(p, text, size=13, east_asia=HEAD_FONT, color=INK)

    def h2(self, text: str):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.first_line_indent = Pt(24)
        _add_rich_text(p, text, size=12, east_asia=HEAD_FONT, color=INK)

    def p(self, text: str, indent: bool = True, bold: bool = False,
          align=WD_ALIGN_PARAGRAPH.JUSTIFY, size: float = BODY_SIZE,
          space_before: float = 0, space_after: float = 3):
        p = self.doc.add_paragraph()
        p.alignment = align
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.first_line_indent = Pt(size * 2) if indent else Pt(0)
        if bold:
            text = f"**{text}**"
        _add_rich_text(p, text, size=size)
        return p

    def quote(self, text: str):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.left_indent = Pt(24)
        p.paragraph_format.right_indent = Pt(12)
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(6)
        _add_rich_text(p, text, size=10.5, east_asia="楷体", color=MUTED)

    def bullet(self, text: str, level: int = 0):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.left_indent = Pt(24 + level * 18)
        p.paragraph_format.first_line_indent = Pt(-12)
        p.paragraph_format.space_after = Pt(2)
        _add_rich_text(p, "· " + text, size=BODY_SIZE)

    def center(self, text: str, size: float = 12, bold: bool = False,
               space_before: float = 0, space_after: float = 3,
               east_asia: str = BODY_FONT, color: RGBColor = INK):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        if bold:
            text = f"**{text}**"
        _add_rich_text(p, text, size=size, east_asia=east_asia, color=color)
        return p

    def page_break(self):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run()
        run.add_break(WD_BREAK.PAGE)

    def table(self, headers: Sequence[str], rows: Iterable[Sequence[str]],
              widths: Sequence[float] | None = None, font_size: float = TABLE_SIZE,
              header_fill: str = "E8EDF3", align_center_cols: Sequence[int] = ()):
        rows = [list(r) for r in rows]
        table = self.doc.add_table(rows=1, cols=len(headers))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        _set_table_width(table)
        _cell_margins(table)

        if widths:
            _set_fixed_layout(table, widths)
            for idx, w in enumerate(widths):
                for cell in table.columns[idx].cells:
                    cell.width = Cm(w)

        hdr = table.rows[0]
        _repeat_header(hdr)
        _cant_split(hdr)
        for i, text in enumerate(headers):
            cell = hdr.cells[i]
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            _shade(cell, header_fill)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.space_after = Pt(0)
            _add_rich_text(p, text, size=font_size, east_asia=HEAD_FONT)

        for row in rows:
            tr = table.add_row()
            _cant_split(tr)
            for i, text in enumerate(row):
                cell = tr.cells[i]
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                p = cell.paragraphs[0]
                p.alignment = (WD_ALIGN_PARAGRAPH.CENTER if i in align_center_cols
                               else WD_ALIGN_PARAGRAPH.LEFT)
                p.paragraph_format.line_spacing = 1.15
                p.paragraph_format.space_after = Pt(0)
                _add_rich_text(p, str(text), size=font_size)

        # 表后留白
        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(0)
        spacer.paragraph_format.line_spacing = 0.6
        run = spacer.add_run("")
        _set_run_font(run, size=6)
        return table

    def signature_table(self, left_title: str, right_title: str,
                        left_rows: Sequence[Sequence[str]], right_rows: Sequence[Sequence[str]]):
        table = self.doc.add_table(rows=1, cols=2)
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        _set_table_width(table)
        _cell_margins(table, top=120, bottom=120, left=140, right=140)
        _set_fixed_layout(table, (7.5, 7.5))
        for idx, w in enumerate((7.5, 7.5)):
            for cell in table.columns[idx].cells:
                cell.width = Cm(w)

        for i, (title, rows) in enumerate(((left_title, left_rows), (right_title, right_rows))):
            cell = table.rows[0].cells[i]
            cell.vertical_alignment = WD_ALIGN_VERTICAL.TOP
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(6)
            _add_rich_text(p, title, size=11, east_asia=HEAD_FONT)
            for label, value in rows:
                p = cell.add_paragraph()
                p.paragraph_format.line_spacing = 1.35
                p.paragraph_format.space_after = Pt(2)
                _add_rich_text(p, f"{label}：{value}", size=10.5)

    def save(self, path: str):
        self.doc.save(path)
