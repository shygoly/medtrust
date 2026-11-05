#!/usr/bin/env python3
"""Build the three-party interaction architecture & deployment plan DOCX.

Sources of truth (all in-repo, verified when this script was written):
  ARCHITECTURE.md §3/§6, DEPLOY.md §1–§4, docs/deploy/部署硬件需求-v2.md,
  docs/丝路数港-身份对接可行性评估.md, docs/丝路数港-接口对拍表.md,
  docs/连接器部署安装步骤-内部运维.md, docs/omop-cdm-onboarding.md,
  openspec/changes/connector-agent-deidentification/phase3-alignment-pseudonym.md

Usage:
  python3 scripts/build-three-party-deployment-docx.py \
      --out docs/MedTrust-三方交互架构与部署方案-v1.0.docx
"""

from __future__ import annotations

import argparse
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BLACK = RGBColor(0x1A, 0x1A, 0x1A)
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
MUTED = RGBColor(0x59, 0x59, 0x59)
HEADER_FILL = "1F4E79"
PALE_FILL = "EAF1F8"
NOTE_FILL = "F2F2F2"
BORDER = "BFBFBF"

CJK_FONT = "Microsoft YaHei"
MONO_FONT = "Consolas"


# ---------------------------------------------------------------- low level


def set_run_font(run, *, size=None, bold=None, color=None, mono=False) -> None:
    run.font.name = MONO_FONT if mono else CJK_FONT
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    target = MONO_FONT if mono else CJK_FONT
    fonts.set(qn("w:ascii"), target)
    fonts.set(qn("w:hAnsi"), target)
    fonts.set(qn("w:eastAsia"), CJK_FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def cell_borders(cell, color: str = BORDER) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def fixed_layout(table, widths_cm: list[float]) -> None:
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    total = sum(widths_cm)
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:type"), "dxa")
    tbl_w.set(qn("w:w"), str(int(total * 567)))
    grid = table._tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for index, column in enumerate(grid.findall(qn("w:gridCol"))):
            if index < len(widths_cm):
                column.set(qn("w:w"), str(int(widths_cm[index] * 567)))


def repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


# ---------------------------------------------------------------- content blocks


def add_rich_text(paragraph, text: str, *, size: float, color: RGBColor | None = None,
                  bold: bool = False) -> None:
    """把 `**加粗**` 渲染成真加粗（正文里不残留 markdown 星号）。"""
    parts = text.split("**")
    for index, part in enumerate(parts):
        if not part:
            continue
        run = paragraph.add_run(part)
        set_run_font(run, size=size, bold=(bold or index % 2 == 1), color=color)


class Doc:
    def __init__(self) -> None:
        self.doc = Document()
        self._setup()

    def _setup(self) -> None:
        section = self.doc.sections[0]
        section.page_width = Cm(21.0)
        section.page_height = Cm(29.7)
        section.left_margin = Cm(2.4)
        section.right_margin = Cm(2.4)
        section.top_margin = Cm(2.4)
        section.bottom_margin = Cm(2.2)

        style = self.doc.styles["Normal"]
        style.font.name = CJK_FONT
        style.font.size = Pt(10.5)
        style.element.rPr.rFonts.set(qn("w:eastAsia"), CJK_FONT)
        style.paragraph_format.line_spacing = 1.45
        style.paragraph_format.space_after = Pt(6)

    # ---- text
    def h1(self, text: str) -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(20)
        p.paragraph_format.space_after = Pt(8)
        run = p.add_run(text)
        set_run_font(run, size=17, bold=True, color=ACCENT)
        self._rule(p)

    def h2(self, text: str) -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(6)
        run = p.add_run(text)
        set_run_font(run, size=13, bold=True, color=ACCENT)

    def h3(self, text: str) -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run(text)
        set_run_font(run, size=11, bold=True, color=BLACK)

    def para(self, text: str, *, muted: bool = False, indent: float = 0) -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(indent)
        add_rich_text(p, text, size=10.5, color=MUTED if muted else BLACK)

    def bullet(self, text: str, *, level: int = 0) -> None:
        p = self.doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Cm(0.9 + level * 0.6)
        p.paragraph_format.space_after = Pt(3)
        add_rich_text(p, text, size=10.5)

    def steps(self, items: list[str]) -> None:
        """编号步骤：责任方写在前面，用「—」分隔。"""
        for index, item in enumerate(items, start=1):
            p = self.doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.9)
            p.paragraph_format.space_after = Pt(3)
            num = p.add_run(f"{index:>2}. ")
            set_run_font(num, size=10.5, bold=True, color=ACCENT)
            add_rich_text(p, item, size=10.5)

    def mono(self, text: str) -> None:
        lines = text.splitlines()
        for index, line in enumerate(lines):
            p = self.doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.left_indent = Cm(0.6)
            # 代码/示意图整块不跨页：断在中间比缩进错位更难读
            p.paragraph_format.keep_together = True
            p.paragraph_format.keep_with_next = index < len(lines) - 1
            run = p.add_run(line)
            set_run_font(run, size=9, mono=True, color=BLACK)

    def note(self, title: str, text: str) -> None:
        table = self.doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        cell.text = ""
        shade(cell, NOTE_FILL)
        cell_borders(cell, "D0D0D0")
        p = cell.paragraphs[0]
        run = p.add_run(f"{title}　")
        set_run_font(run, size=9.5, bold=True, color=ACCENT)
        add_rich_text(p, text, size=9.5, color=BLACK)
        self.doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # ---- tables
    def table(self, headers: list[str], rows: list[list[str]], widths: list[float] | None = None,
              *, font: float = 9.0, caption: str | None = None,
              keep_together: bool | None = None) -> None:
        """小表默认整表不跨页（keep_with_next 贯穿各行）；长表允许跨页并重复表头。"""
        if keep_together is None:
            keep_together = len(rows) <= 6
        if caption:
            p = self.doc.add_paragraph()
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(2)
            run = p.add_run(caption)
            set_run_font(run, size=9, bold=True, color=ACCENT)

        table = self.doc.add_table(rows=1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False

        head = table.rows[0]
        repeat_header(head)
        for index, title in enumerate(headers):
            cell = head.cells[index]
            cell.text = ""
            shade(cell, PALE_FILL)
            cell_borders(cell)
            run = cell.paragraphs[0].add_run(title)
            set_run_font(run, size=font, bold=True, color=ACCENT)
            cell.paragraphs[0].paragraph_format.space_after = Pt(1)

        for row_data in rows:
            row = table.add_row()
            for index, value in enumerate(row_data):
                cell = row.cells[index]
                cell.text = ""
                cell_borders(cell)
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_after = Pt(1)
                paragraph.paragraph_format.line_spacing = 1.2
                add_rich_text(paragraph, str(value), size=font)

        if widths:
            for row in table.rows:
                for index, width in enumerate(widths):
                    row.cells[index].width = Cm(width)
            fixed_layout(table, widths)

        if keep_together:
            for row in table.rows[:-1]:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        paragraph.paragraph_format.keep_with_next = True
        self.doc.add_paragraph().paragraph_format.space_after = Pt(2)

    # ---- misc
    def _rule(self, paragraph) -> None:
        p_pr = paragraph._p.get_or_add_pPr()
        borders = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "4")
        bottom.set(qn("w:color"), HEADER_FILL)
        borders.append(bottom)
        p_pr.append(borders)

    def page_break(self) -> None:
        self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(str(path))


def footer(doc: Document, text: str) -> None:
    section = doc.sections[0]
    paragraph = section.footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(text)
    set_run_font(run, size=8, color=MUTED)


# ---------------------------------------------------------------- document body


def cover(d: Doc) -> None:
    for _ in range(3):
        d.doc.add_paragraph()

    p = d.doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run("MedTrust 可信数据空间")
    set_run_font(run, size=26, bold=True, color=ACCENT)

    p = d.doc.add_paragraph()
    run = p.add_run("医院 · MedTrust 平台 · 丝路数港国家节点")
    set_run_font(run, size=20, bold=True, color=BLACK)

    p = d.doc.add_paragraph()
    run = p.add_run("三方交互架构与部署方案")
    set_run_font(run, size=20, bold=True, color=BLACK)

    d.doc.add_paragraph()
    d.table(
        ["项", "内容"],
        [
            ["文档版本", "v1.0（2026-11）"],
            ["适用范围", "可信数据空间试点部署、院方 IT/安全评审、国家节点对接准备"],
            ["读者", "医院信息科与 DBA、平台运维、药企/研究方对接人、合规与审计"],
            ["口径来源", "ARCHITECTURE.md · DEPLOY.md · 部署硬件需求-v2.md · 丝路数港接口对拍表 · "
                        "omop-cdm-onboarding.md · DECISIONS（D-CN-4/6/9/10）"],
            ["一句话", "原始数据不出医院；跨域只走任务定义、聚合结果与证据哈希；"
                      "国家节点只做主体互认与目录可见，不承载行级数据。"],
        ],
        widths=[3.2, 12.6],
    )

    d.doc.add_paragraph()
    d.note(
        "阅读顺序建议",
        "第 2 章看结构（谁在哪、边界在哪）→ 第 3 章看三方各交换什么 → 第 4 章看五个可执行流程 → "
        "第 5 章照单采购与部署 → 第 6 章按故障表处置。",
    )
    d.page_break()


def toc(d: Doc) -> None:
    d.h1("目录")
    entries = [
        ("1", "方案范围与三方角色"),
        ("2", "总体架构与信任边界"),
        ("3", "三方交互设计（交换什么、怎么鉴权）"),
        ("4", "工作流程（五个可执行场景）"),
        ("5", "部署方案（形态、机器、网络、密钥、上线顺序）"),
        ("6", "运维、故障处置与轮换"),
        ("7", "合规边界与如实声明"),
        ("8", "附录：端口、关键配置、术语、依据文件"),
    ]
    for number, title in entries:
        p = d.doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.6)
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run(f"{number}.  {title}")
        set_run_font(run, size=11, bold=False, color=BLACK)
    d.page_break()


def chapter_1(d: Doc) -> None:
    d.h1("1　方案范围与三方角色")

    d.h2("1.1　三方各是什么")
    d.table(
        ["角色", "主体", "在方案里做什么", "不做什么"],
        [
            [
                "数据提供方",
                "医院（每家一套连接器 + 院内 agent + 本院 PostgreSQL）",
                "持原始数据；按合约做最小投影；院内完成去标识与跨院对齐；本地执行计算；只回传聚合结果",
                "不上传行级数据；不把库连接交给平台或 agent；不对平台开放入站端口",
            ],
            [
                "空间运营方",
                "MedTrust 平台（控制面 apps/api + 控制台 apps/web）",
                "目录与数据产品、数字合约与使用控制、任务编排（MDOP 分段下发）、结果合并、存证、结算、脱敏规格与词表签发",
                "不接触原始数据；不持盐、不持对齐密钥、不持连接器私钥；不见跨院对齐键",
            ],
            [
                "国家基础设施区域功能节点",
                "丝路数港（西安节点，国家数据流通利用主干网）",
                "主体注册与跨域身份互认、数据产品目录「一点发布、全域可见」、审计摘要接收、后续可能的存证托管",
                "不承载行级数据；不是权威身份源（无 OIDC/政务身份断言）；不替代本空间 SM2 CA",
            ],
        ],
        widths=[2.6, 4.4, 6.4, 5.0],
        caption="表 1-1　三方职责边界",
    )

    d.h2("1.2　层级关系")
    d.para(
        "国家级主干网在上，区域节点居中，可信数据空间（本平台）在其下，医院在最末端。"
        "数据只在「医院 → 空间」这一段横向流动，且以聚合形态跨院；向上到区域节点只有元数据与摘要。",
    )
    d.table(
        ["层级", "主体与组件", "与上一层的接口（只走元数据）"],
        [
            ["① 国家级", "国家数据基础设施·全域功能节点（国家数据局主导）",
             "主体注册互认、目录全域可见、审计摘要接收"],
            ["② 区域级", "丝路数港·西安区域功能节点（已与国家全域功能节点正式对接）",
             "P2-8 三件事：身份互认 + 目录同步 + 日志上报（本方案第 3.3 节）"],
            ["③ 空间级", "MedTrust 可信数据空间：控制面 api :5021 + 控制台 web :5020 + 数字合约 + MDOP 编排",
             "向 ② 推元数据；对 ④ 只发片段、只收 C3（平台无法主动连入院内网）"],
            ["④ 院内级", "每家医院：连接器 :5022（唯一出站组件）+ 院内 agent :5024 + 本院 PostgreSQL",
             "连接器只主动出站长轮询与结果回传；agent 只在院内网监听"],
            ["⑤ 数据源", "本院 EHR / OMOP CDM 只读视图（CDM 只读 + results 可写双权限域）",
             "连接器经受限账号读取；底表不对连接器授权"],
        ],
        widths=[1.8, 7.4, 6.6],
        caption="表 1-3　五层拓扑（自上而下）",
        font=8.5,
    )
    d.para(
        "关键不变量：⑤→④ 的行级数据只在院内；④→③ 只有 C3 聚合；③→② 只有元数据与摘要。"
        "三层之间没有任何一条边能带回行级记录。",
        muted=True,
    )

    d.h2("1.3　四个必须先说清的概念")
    d.table(
        ["概念", "含义", "在本方案中的落点"],
        [
            ["数据不出域", "原始行级数据不出医院控制边界；跨域只有任务定义（入）、聚合结果（出）、证据哈希（上链）",
             "长轮询、C3 出域闸门、local_audit_log"],
            ["分级 C0–C3", "C0 院内 / C1 密文信封出域前的边界 / C2 可信空间内受控 / C3 可对外聚合",
             "编译期标签检查 + 出节点守卫"],
            ["MDOP 分段", "平台只发「本院那一份片段」，收齐各院 C3 后合并；凭证 + 数据快照重算阻断挪用",
             "cp_mdop_* 表族、StageDispatch 幂等"],
            ["三统一", "统一目录标识 / 统一身份 / 统一接口（NDI-TR-2025 系列）",
             "urn:tds:* → NDI 标识映射、连接器证书、接口对拍表"],
        ],
        widths=[2.6, 8.0, 5.8],
        caption="表 1-2　概念对齐",
    )


def chapter_2(d: Doc) -> None:
    d.h1("2　总体架构与信任边界")

    d.h2("2.1　组件清单（部署视角）")
    d.table(
        ["侧", "组件", "进程/端口", "职责", "部署位置"],
        [
            ["平台", "medtrust-web", "Next.js :5020", "控制台、landing；对 API 走同源 /api/v1", "平台机（公网经 nginx）"],
            ["平台", "medtrust-api", "NestJS :5021", "目录/合约/身份 CA/编排/合并/存证/结算；MDOP 编译器与凭证", "平台机"],
            ["平台", "PostgreSQL 15", ":5432（内网）", "控制面元数据（cp_*），永不存行级医疗数据", "平台机"],
            ["平台", "Vault", ":8200（内网）", "平台密钥（KEK 加密后落库）；不存医院盐", "平台机"],
            ["平台", "ChainMaker 节点 + sidecar", ":8090", "合约/任务/结果哈希与连接器背书上链", "自建链：3 台独立机"],
            ["平台", "LLMA 推理机", "内网", "作业详情页「结果解读」草稿（只引用已发布数字）", "平台机或追加 1 台"],
            ["医院", "连接器（NestJS）", ":5022，管理面只绑 127.0.0.1", "唯一出站组件：领任务、取数、投影、闸门、回传；PEP 使用控制", "医院 DMZ / 前置机区"],
            ["医院", "院内 agent（Python）", ":5024，仅院内网络 + x-agent-token", "计算后端：L3/L4 重算；agent 模式下执行平台签发的脱敏规格", "与连接器同院（可同机）"],
            ["医院", "本院 PostgreSQL", ":5432（内网）", "连接器本地状态：local_record、审计链、数据源状态", "医院应用机或独立库机"],
            ["国家节点", "丝路数港区域功能节点", "对方提供", "主体注册/互认、目录接收、审计摘要", "节点运营方机房（不属本方案）"],
        ],
        widths=[1.6, 3.4, 3.4, 5.4, 3.0],
        caption="表 2-1　组件与部署位置",
    )

    d.h2("2.2　四条边界（架构不变量）")
    d.steps([
        "医院 ← 平台：只有连接器主动出站（长轮询 ≤25s 挂起、结果回传）；平台**没有任何进入院内网的路径**（D-CN-4）。",
        "医院内部：连接器独占数据源凭据与库句柄；agent 无凭据、无文件读、只在院内网监听（D-CN-6）。",
        "跨院：只经 C2 节点的**密文信封**或本院的 C3 聚合；院内假名 subjectKey 各院不同、不可跨院。",
        "平台内部：控制面只存元数据；行级医疗字段进控制面即违反 D1（DOMAIN 覆盖矩阵机检）。",
    ])

    d.h2("2.3　数据分级与唯一允许的出域形态")
    d.table(
        ["分级", "内容", "允许去向", "机制"],
        [
            ["C0 院内", "原始行、直接标识、盐、连接串、金标准标注", "不出院（任何跨域边禁止）", "LocalStore 拒绝外部读 + 审计留痕；编译期 C0 边即拒"],
            ["C1", "跨组织交换的中间物（本期不开放跨域 C1 边）", "本院边界内", "编译器本期直接拒 C1 跨域边"],
            ["C2", "密文信封：密文 + 摘要 + 包裹密钥引用 + 使用策略 + 水印 + 持有方签名", "可信空间节点（飞地）内", "远程证明通过才释放密钥；`export=C3_only`"],
            ["C3", "聚合计数/效应量/模型工件（过 minCell 与小格抑制）", "平台合并、对外交付", "输出闸门 fail-closed（D-UC-2）"],
        ],
        widths=[1.8, 6.2, 4.0, 4.6],
        caption="表 2-2　分级与出域形态",
    )
    d.note(
        "别写错的一句话",
        "「密文信封出域」在法律定性上仍是数据出域/委托处理（REGULATORY.md REG-08）：判定依据是"
        "控制者边界是否变化，而不是传输是否加密。因此跨组织 C2 节点必须放在中立第三方或监管侧，"
        "且数据密钥不得由平台持有（D-TEE-1）。",
    )


def chapter_3(d: Doc) -> None:
    d.h1("3　三方交互设计")

    d.h2("3.1　医院 ↔ 平台：一个出站通道，六类消息")
    d.table(
        ["消息", "方向", "承载", "鉴权/校验", "失败语义"],
        [
            ["领取任务（长轮询）", "医院 → 平台（请求）；平台 → 医院（响应）", "GET /api/v1/connector/tasks/pending?waitMs=",
             "连接器证书签名 + HMAC/令牌；响应逐个任务带平台 SM2 签名，连接器验签并核对目标参与方",
             "验签失败：不执行、记 task-signature-invalid、上报失败；网络失败指数退避"],
            ["任务回传（C3）", "医院 → 平台", "POST …/assignments/:id/complete（含 aggregateHash + 结果级背书）",
             "平台重算 SM3 比对 + 连接器 SM2 背书验证", "摘要不符即拒；不放行未背书的渐进路径"],
            ["进度/心跳", "医院 → 平台", "POST …/progress、/heartbeat", "同上", "失败仅影响在线状态展示"],
            ["审计摘要", "医院 → 平台", "POST …/audit-digest（链式 prevHash + blocked 事件）", "平台校验链完整性", "失败重试，不影响任务"],
            ["脱敏规格 / 词表清单 / 吊销", "平台 → 医院（随批次下发）", "批次字段 deidSpecs / deidRevocations / deidDictionaries",
             "registry 用途密钥 SM2 验签 + kid 对齐 + 版本单调 + 吊销名单版本单调 + 时效",
             "缺包/坏包：规格不可用 → agent 模式 fail-closed（不退回内置弱脱敏）"],
            ["模块（可选算法）", "医院 → 平台（按 SM3 拉取）", "GET /api/v1/connector/modules/:sm3", "SM3 + 平台签名 + 吊销名单 + 白名单",
             "任一不过：不执行，任务失败"],
        ],
        widths=[3.0, 3.4, 3.6, 4.0, 4.0],
        caption="表 3-1　医院与平台的六类消息",
        font=8.5,
    )

    d.h2("3.2　医院 ↔ 医院（经 C2 节点）：只交换密文信封")
    d.steps([
        "各院把「所需最小投影」封成密文信封：密文、密文摘要、被包裹的数据密钥引用、使用策略（合约/用途/允许算子/证明策略/export=C3_only/到期）、水印、持有方签名；aad 绑定作业、凭证、合约。",
        "连接器把信封**出站**送到 C2 节点（中立第三方/监管侧 VPC），平台不参与解密。",
        "节点在通过远程证明的飞地内解密，按合约内允许算子执行（如跨院按人观察期并集、事件去重），中间步骤强制标记 C0_internal 并只在飞地内存驻留。",
        "只输出 C3 聚合（过 minCell / minCellRare 双阈值），平台收集各院 C3 后合并。",
    ])
    d.para(
        "跨院逐人对齐用的不是院内假名，而是**共管密钥派生的对齐键**：同一主体在两院算出同一个值，"
        "不同研究项目因用途域不同而算不出同一个值；平台不持该密钥、也看不到对齐键（D-CN-10）。",
        muted=True,
    )

    d.h2("3.3　MedTrust ↔ 丝路数港国家节点：只走元数据")
    d.table(
        ["接口域", "方向", "MedTrust 侧落点", "推送/拉取内容", "状态"],
        [
            ["主体注册拉取 + 身份互认", "拉", "POST /admin/interop/silk-road/sync → cp_interop_subject → cp_participant",
             "机构名称、统一社会信用代码、区域、法定代表人（不含任何患者信息）", "已落地（HTTP 客户端消息语义待接口文档）"],
            ["注册主体检索 / 带入认证", "空间内", "GET/POST /account/interop/silk-road/subjects", "USCC 检索、预填机构认证申请", "已落地"],
            ["目录推送（一点发布）", "推", "POST /admin/interop/silk-road/push-catalog ← cp_data_product",
             "URN/NDI 标识、标题、提供方、类型、分级、记录数量级（**不含样本、不含行**）", "已落地"],
            ["审计摘要上报", "推", "POST /admin/interop/silk-road/report-audit ← /audit/export",
             "审计链完整性结论与总数（不含明细敏感字段）", "已落地"],
            ["连接器审计摘要周期上报", "推", "cp_connector_audit_digest", "链摘要与阻断计数", "实体已存在，推送端待接口文档"],
            ["主体状态回推 / 外部目录拉取", "推 / 拉", "SilkRoadClient 预留", "认证结果、外部产品元数据", "待接口文档"],
        ],
        widths=[3.2, 1.4, 4.6, 5.2, 3.0],
        caption="表 3-2　与国家节点的接口对拍",
        font=8.5,
    )
    d.note(
        "配置与 fail-closed",
        "SILKROAD_NODE_ENDPOINT 为空时互认能力 fail-closed（生产环境返回 FailClosedSilkRoadClient），"
        "本地目录/任务/存证不受影响——离线可用性是硬要求。",
    )

    d.h2("3.4　谁绝不该收到什么")
    d.table(
        ["对象", "绝不该收到", "机制"],
        [
            ["平台", "原始行、直接标识、盐、对齐密钥、链接键、连接器私钥、金标准标注", "DOMAIN 覆盖矩阵 + 平面隔离 + 编译期标签检查"],
            ["国家节点", "行级数据、患者标识、审计明细中的敏感字段、对齐键", "只推元数据与摘要（表 3-2 内容列）"],
            ["跨院节点（C2）", "明文记录、盐、院内假名 subjectKey", "只有密文信封；解密仅在通过远程证明的飞地内"],
            ["药企/研究方", "任何小于 minCell 的单元格、跨层合计", "输出闸门 + 发布审查"],
        ],
        widths=[2.6, 7.4, 6.4],
        caption="表 3-3　反向清单（评审时逐条问）",
    )


def chapter_4(d: Doc) -> None:
    d.h1("4　工作流程")

    d.h2("4.1　流程一：医院接入（预计 5–10 个工作日）")
    d.table(
        ["步", "动作", "责任方", "完成判据"],
        [
            ["1", "院内视图层：按 OMOP CDM v5.4 建 cdm/vocabulary/results 三个 schema 的只读视图（去直接标识、可做行级过滤）", "医院 DBA",
             "视图可读、底表不可达、视图不可写"],
            ["2", "建连接器专用账号：CDM 视图只读 + results schema 可建表可写（双权限域）", "医院 DBA", "非超级用户、无 BYPASSRLS、权限域恰为两项"],
            ["3", "网络放行：连接器仅主动出站到平台 443（或专用端口），院内网不开放入站", "医院网络", "出站白名单生效、平台无法反向连入"],
            ["4", "部署跳板机 + 加固，运维经 ProxyJump 进连接器宿主", "医院运维", "管理面无公网暴露、连接器 :5022 只绑 127.0.0.1"],
            ["5", "部署连接器与院内 agent（两个容器），配置 .env（参与方 ID、平台地址、SM2 私钥、agent token）", "医院运维 + 平台",
             "启动无报错、长轮询已启动"],
            ["6", "平台注册参与方并签发 SM2 证书；连接器加载证书与私钥", "平台", "证书指纹一致、验签通过"],
            ["7", "接入校验：账号属性/最小权限/视图存在且不可写/results 可写/元数据可读", "连接器自动",
             "六项全通过；任一不过即数据源不可用（不降级到文件）"],
            ["8", "数据源声明 + 目录发布（label、类型、覆盖统计：仅数量级与观察期到月）", "医院 + 平台", "目录可见、覆盖元数据标注「该院自报」"],
        ],
        widths=[1.0, 7.0, 2.6, 5.8],
        caption="表 4-1　医院接入八步",
        font=8.5,
    )
    d.para(
        "闭环验收：连接器健康核验逐项通过 → 一条最小任务跑通（本地投影 → C2 阶段 → C3 出域）→ "
        "医院执行 REVOKE 后下一次复核即判数据源不可用（证明医院可单方面切断）。",
        muted=True,
    )

    d.h2("4.2　流程二：跨院 RWS 任务全链路（一次任务的十二步）")
    d.table(
        ["步", "环节", "动作", "失败即"],
        [
            ["1", "提交", "药企/研究方在控制台选数据产品与目的，提交任务（分析类型 + 队列定义 + 时间窗）", "参数非法退回"],
            ["2", "编译", "MDOP 编译器按放置规则生成**各院自己的片段**（含标签、能力、合约要求），算 plan_hash", "任一跨域 C0/C1 边 → 拒编译"],
            ["3", "要约", "PlanFragmentOffer 只发本院片段，连接器**只认本地合约副本**做七项复核", "复核不过 → 拒绝，作业不跑"],
            ["4", "凭证", "连接器用本院私钥签凭证核心 + 数据快照；平台收集接受后签发 ExecutionTicketIssue", "缺接受方 → 作业不派发"],
            ["5", "调度", "StageDispatch（幂等 job:stage:attempt）按上游就绪下发；连接器执行前重算数据快照比对", "快照不符 → 拒执行（防数据被换）"],
            ["6", "取数", "连接器按合约做列裁剪 + 行过滤（下推到 SQL / 视图），产出受限投影", "数据源不可用 → 任务失败，不改用文件"],
            ["7", "脱敏", "builtin：连接器逐行脱敏；agent 模式：平台签发规格 → 院内 agent 执行 → 回执摘要本地重算校验", "规格/盐/词表缺失或回执不符 → fail-closed"],
            ["8", "执行", "签名 wasm 模块在零能力沙箱内跑（超时/内存超限即终止）；L3/L4 由院内 agent 承接", "模块被吊销/签名不符 → 不执行"],
            ["9", "出节点", "只投 C3 且目标在合约接收方列表；输出闸门做小格抑制（minCell，罕见病 minCellRare）", "闸门不过 → 结果不出域"],
            ["10", "合并", "平台收齐各院 C3 后按统计口径合成（如四格表按格相加、效应量随机效应合并）", "缺一方 → 不做部分合并"],
            ["11", "存证", "结果哈希 + 连接器背书 + 合并清单锚定到链（fail-open + 补偿队列）", "上链失败 → 不入库阻断，进补偿"],
            ["12", "交付与结算", "结果进结果页与解读（只引用已发布数字）；按贡献分账；到期销毁编排 + 回执链", "结算失败 → 台账补偿"],
        ],
        widths=[0.9, 1.8, 9.4, 4.3],
        caption="表 4-2　任务全链路",
        font=8.5,
    )

    d.h2("4.3　流程三：跨组织逐人对齐（SCRI / 疫苗效果 / 跨院去重 / 主体配对）")
    d.steps([
        "各院在本院用**共管密钥 + 用途域**把真实标识派生为对齐键（lk_ 前缀，含 kid），此后真实标识即丢弃。",
        "各院封最小投影（对齐键、年龄带、性别、观察起止、白名单编码），账号内不出院：院内假名 subjectKey 不进投影。",
        "密文信封出站到中立第三方/监管侧的 C2 节点；平台只路由句柄，不解密、不见明文。",
        "飞地内解密 → 按合约允许算子逐人对齐/去重/取并集 → 只出 C3 聚合（双阈值抑制）。",
        "平台合并各院 C3；结果页给出去重前后对比（各院直接相加 vs 节点内去重），两个口径都过闸。",
    ])
    d.para(
        "缺密钥、缺标识、标识非法时**不产生对齐键**，该记录自然不参与出域（不拿院内假名顶替）；"
        "不同研究项目用不同用途域，跨项目不可链接。",
        muted=True,
    )

    d.h2("4.4　流程四：脱敏下沉到院内 agent（大数据量 / 自由文本）")
    d.table(
        ["步", "动作", "校验点"],
        [
            ["1", "平台签发脱敏规格（封闭算子集、参数上界 k≥5/maxDays≤30/outLen≤64、强制字段必覆盖）", "schema 不通过即拒签"],
            ["2", "规格与吊销名单随长轮询批次下发；词表清单（只有摘要与版本）同批下发", "registry 公钥验签 + kid 对齐 + 版本单调 + 时效"],
            ["3", "连接器做降级检测：与合约「脱敏口径」条款逐条比对", "缺字段/keep/k 偏低/关掉小格抑制 → 判降级并拒"],
            ["4", "连接器按 D-CN-6 做受限投影，gRPC 双向流发给院内 agent（带 x-agent-token）", "无令牌即拒；row_limit 越界即拒"],
            ["5", "agent 再校验规格（自洽摘要 + 算子集 + 上界）、从本院 Vault 取盐、按 ref 读本院词表并核对摘要", "缺盐/摘要不符 → DENIED（不兜底）"],
            ["6", "逐行变换 → 残留检测（手机号/身份证/邮箱/地址/词表姓名）→ 命中即 FAILED 且该行不发出", "残留不带进下游与本地库"],
            ["7", "回执返回（input/output 摘要 + 规格摘要 + 审计链摘要）；连接器本地重算后入库", "任一摘要不符 → 任务失败"],
            ["8", "agent 本地审计链追加（拒绝也留痕）；条目只含元数据与摘要", "重启不丢，可校验前向链接"],
        ],
        widths=[1.0, 10.4, 5.0],
        caption="表 4-3　agent 模式脱敏的八个校验点",
        font=8.5,
    )

    d.h2("4.5　流程五：与国家节点的互认与发布")
    d.steps([
        "平台向区域节点拉取注册主体（定时 + 手动），upsert 到 cp_interop_subject；无对应参与方时按机构名/统一社会信用代码自动带入，生成待确认的参与方记录。",
        "机构认证页按 USCC 检索已同步主体并「带入」预填，审核通过后本空间内生效（外部节点只提供互认断言，密码学身份仍由本空间 SM2 CA 签发）。",
        "数据产品发布为 active 后，目录推送把元数据（NDI 标识、标题、提供方、类型、分级、记录数量级）推到区域节点——**不含样本与行**。",
        "审计摘要周期上报（完整性结论 + 总数），与连接器本地审计链摘要可对账。",
        "区域节点接口文档到位后，补齐：主体状态回推、外部目录拉取、连接器审计摘要周期推送；届时再决定是否把存证托管给节点（省三台共识节点，信任锚换成外部运营）。",
    ])


def chapter_5(d: Doc) -> None:
    d.h1("5　部署方案")

    d.h2("5.1　三种形态（按此采购，不按最大想象力采购）")
    d.table(
        ["形态", "机器构成", "合计", "适用"],
        [
            ["最小版（自建链）", "平台 1 台 8C/32G/500G；共识节点 3 台 4C/8G/100G；每院 1 台 8C/16G/200G",
             "4 台 + 每院 1 台（20 vCPU / 56 GB / 800 GB 起）", "试点、演示、1–2 家医院"],
            ["最小版（节点托管存证）", "平台 1 台；每院 1 台（共识节点为 0，**条件性**：写/读/背书三问由对方接口确认后才成立）",
             "1 台 + 每院 1 台", "与国家节点已确认存证口径时"],
            ["标准版", "最小版 + 跨组织 C2 节点 2 台（teeA 8C/32G TDX + teeB 4C/8G）；结果解读 1 台 4C/16G",
             "在最小版上 +3 台", "跨院逐人对齐、结果解读上线"],
            ["高可用版", "平台拆 7 台（API 双活 + 库主从）、链节点升配、第 4 台共识（TBFT）", "按 §4.1 的增量表", "医院数十家同时在线"],
        ],
        widths=[3.0, 9.6, 3.4, 3.4],
        caption="表 5-1　部署形态",
        font=8.5,
    )
    d.note(
        "两处「TEE」不要混",
        "跨组织 C2 节点放**中立第三方/监管侧**（决策 D-TEE-1：平台持钥即等价明文，禁止）；"
        "院内飞地是可选项，只解决院内信任，不承担跨组织对齐。",
    )

    d.h2("5.2　平台侧部署（单机 compose 起步）")
    d.table(
        ["项", "内容"],
        [
            ["入口", "公网 web.szchada.top → Cloudflare → nginx → web :5020；/api/v1 与 /ws 同源回源到 api :5021"],
            ["进程", "web、api、PostgreSQL 15、Vault、链 sidecar（:8090）、LLMA（可选）、chat-agent（可选 :5032）"],
            ["数据", "控制面元数据（cp_*）与租户/审计；PostgreSQL-only，不再用 SQLite（2026-10-19 起）"],
            ["密钥", "三把用途互斥平台密钥（CA 根钥 / 平台节点钥 / 注册中心钥），SM4 信封加密后落库，KEK 来自 PLATFORM_KEK；生产缺 KEK 拒绝启动"],
            ["发布", "镜像 + compose 编排；前端发布为独立批（rel-*），需重建 WEB 产物后刷新"],
            ["备份", "库逻辑备份 + 密钥材料离线备份（KEK 与密钥库分置）"],
        ],
        widths=[2.6, 13.2],
        caption="表 5-2　平台侧要点",
    )

    d.h2("5.3　医院侧部署（唯一出站组件）")
    d.table(
        ["项", "内容", "判据"],
        [
            ["放置", "DMZ / 前置机区，与 HIS 核心库、业务内网分区", "网络分隔，不共享管理网"],
            ["拓扑", "连接器 :5022（管理面只绑 127.0.0.1）+ 院内 agent :5024（仅院内网）+ 本院 PostgreSQL :5432", "平台无法主动连入任何端口"],
            ["出站策略", "只允许连接器出站到平台域名/IP + 固定端口（443 或专用端口）；TLS 1.3 + mTLS", "白名单命中率 100%，其余拒绝"],
            ["运维通道", "跳板机（bastion）2C/4G/40G + ProxyJump；连接器管理面不出院内网", "运维无需登录连接器宿主公网"],
            ["容器加固", "每院独立 internal 网络，仅通本院节点与 api；只读根、丢能力、资源上限", "compose 加固清单逐项核对"],
            ["数据访问", "OMOP CDM 视图 + 受限账号（CDM 只读 + results 可写双权限域）", "六项接入校验全通过"],
            ["算法执行", "签名 wasm 模块在零能力沙箱内实例化（能力受限 ≠ 进程隔离，attestationLevel 仍为 software）", "不对院方声称已具备 TEE"],
            ["本地留存", "local_record（去标识后）、local_audit_log（链式哈希）、local_data_source_status", "行级数据只在这里"],
        ],
        widths=[2.4, 10.4, 3.0],
        caption="表 5-3　医院侧部署判据",
        font=8.5,
    )

    d.h2("5.4　国家节点对接的部署影响")
    d.bullet("本侧不新增机器：只需 api 能出站到 SILKROAD_NODE_ENDPOINT（443），并配置 SILKROAD_NODE_ID。")
    d.bullet("未配置时互认能力 fail-closed，本地目录/任务/存证照常——离线可用性不得被外部依赖抬高。")
    d.bullet("标识出域前做 NDI 映射（urn:tds:* → NDI 标识），机构码 NDI_ORG_CODE 未配置则对外接口拒绝，不猜默认值。")
    d.bullet("若存证改由节点托管：撤 3 台共识节点，但须先确认写/读/背书三问，且 TRUST 的第三方托管条目需同步更新。")

    d.h2("5.5　网络与端口矩阵")
    d.table(
        ["源", "目标", "端口/协议", "用途", "方向"],
        [
            ["连接器", "平台 api", "443 / HTTPS + mTLS", "长轮询领任务、回传 C3、心跳、审计摘要、拉模块", "出站"],
            ["连接器", "本院 agent", "5024 / gRPC", "计算委派、agent 模式脱敏", "院内"],
            ["连接器", "本院 PostgreSQL", "5432", "本地状态与审计", "院内"],
            ["连接器", "本院 CDM 视图库", "5432（可配）", "受限投影取数（只读视图）", "院内"],
            ["连接器", "C2 节点 teeA", "443 / mTLS", "密文信封投递与 C3 回收", "出站"],
            ["浏览器", "平台 nginx/web", "443", "控制台；/api/v1 与 /ws 同源", "入站（平台）"],
            ["平台 api", "Vault / 链 sidecar", "8200 / 8090（内网）", "密钥、存证", "内网"],
            ["平台 api", "丝路数港节点", "443", "主体同步、目录推送、审计上报", "出站"],
            ["运维终端", "医院跳板机", "22", "运维入口", "院内 VPN/专线"],
        ],
        widths=[2.4, 3.2, 3.2, 5.0, 2.0],
        caption="表 5-4　端口矩阵（附录 A 有完整端口表）",
        font=8.5,
    )

    d.h2("5.6　密钥与凭据清单（谁持、放哪、怎么轮换）")
    d.table(
        ["材料", "持有方", "存放", "轮换"],
        [
            ["平台三钥（CA 根钥/平台节点钥/注册中心钥）", "平台", "SM4 信封加密落库，KEK 来自 PLATFORM_KEK", "按 DEPLOY §4.1 三钥切换流程（含回滚）"],
            ["连接器 SM2 私钥 + 证书", "医院", "院内侧，0600 文件或 Vault", "由平台 CA 重签，指纹变更后重启"],
            ["平台公钥（用途分别配置）", "医院连接器", "CONNECTOR_PLATFORM_NODE_PUBKEY / CONNECTOR_REGISTRY_PUBKEY 等", "随平台换钥同步"],
            ["脱敏盐（saltRef → 盐）", "医院", "本院 Vault/KMS；平台只见 saltRef", "换盐等于换假名口径，需重算并留旧盐"],
            ["对齐密钥（lk_）", "参与方共管（每用途一把）", "各参与方自家 Vault；平台不持", "kid 版本化，退役键进 keyring 复算历史"],
            ["词表", "医院", "本院词表目录（AGENT_DEID_DICTIONARY_DIR）", "平台只签摘要，换内容即升版本"],
            ["agent 共享令牌", "医院（连接器与 agent 共用）", "x-agent-token（AGENT_SHARED_TOKEN）", "定期轮换；未配置即拒绝一切调用"],
            ["连接器拉任务令牌（降级用）", "平台/医院", "CONNECTOR_PULL_TOKEN", "仅受控开启（CONNECTOR_TOKEN_AUTH_ALLOWED）"],
        ],
        widths=[4.0, 3.0, 5.4, 5.4],
        caption="表 5-5　密钥与凭据",
        font=8.5,
    )

    d.h2("5.7　上线顺序（与回滚点）")
    d.steps([
        "平台：库 → Vault → api → web → 链 sidecar（每步后跑健康检查）。回滚点：镜像回退 + 库快照。",
        "平台密钥：若从旧口径切到国标三钥分离，按 DEPLOY §4.1 的「切换前/切换/回滚」三步走，切换期两套公钥并存。",
        "医院：视图层与账号 → 网络放行 → 跳板机 → 连接器 → agent → 证书签发 → 接入校验 → 数据源声明。回滚点：停连接器即停全部院内任务，数据不出院。",
        "国家节点：配置 ENDPOINT → 主体同步 → 目录推送抽检 → 审计上报抽检。回滚点：清空 ENDPOINT 即 fail-closed，不影响本地。",
        "跨组织 C2 节点（若有）：teeB 证明校验 → teeA 飞地 → 合约声明 attestation_policy → 单作业演练（合成数据）。回滚点：关闭 prove 开关即回到纯 C1/C3 路径。",
    ])


def chapter_6(d: Doc) -> None:
    d.h1("6　运维、故障处置与轮换")

    d.h2("6.1　上线健康核验清单")
    d.table(
        ["检查项", "期望", "不过怎么办"],
        [
            ["连接器启动日志「长轮询已启动」", "出现，且 cert=on platformKey=on", "检查证书指纹、私钥、平台公钥是否配对"],
            ["平台可连通（长轮询 200）", "有任务即返回，无任务挂起至多 25s", "查网络白名单、时钟偏差（签名有时效）"],
            ["任务验签", "无 task-signature-invalid", "核对部署的平台节点公钥与平台实际密钥"],
            ["数据源接入校验", "六项全通过", "按权限域修复；不可用时任务失败，不改用文件"],
            ["一次最小任务闭环", "C3 出域、结果页可见、存证可查", "按阶段定位（编译/复核/凭证/调度/执行/闸门）"],
            ["审计链可校验", "prevHash 连续，摘要与平台侧一致", "检查本地库写入与时间戳"],
            ["（agent 模式）规格与词表", "规格已装载、kid 对齐、词表摘要相符", "看 deid-spec-rejected / deid-dictionary-rejected 审计"],
            ["（国家节点）互认与目录", "主体数量、目录条目可查", "确认 ENDPOINT/机构码；未配置即 fail-closed（预期行为）"],
        ],
        widths=[4.6, 6.4, 4.8],
        caption="表 6-1　健康核验",
        font=8.5,
    )

    d.h2("6.2　典型故障与处置（都 fail-closed，别试图绕过）")
    d.table(
        ["现象", "根因方向", "处置", "不允许的做法"],
        [
            ["长期领不到任务", "已签合约/assignment 状态、长轮询等待上限、网络", "查合约状态与 assignment 派发日志", "手工伪造任务下发"],
            ["任务验签失败", "平台公钥配错、时钟漂移", "对齐公钥与 NTP", "关闭验签"],
            ["日志出现 task-signature-invalid 并上报失败", "签名内容被代理改动", "查 nginx/代理是否重写 body", "改请求体使其通过"],
            ["数据源不可用", "视图/权限/账号属性变化", "按六项校验定位并修权限", "临时改成读文件继续跑"],
            ["agent 不可达/超时", "院内 agent 停机、token 不符", "恢复 agent、核对 AGENT_SHARED_TOKEN", "连接器本地近似计算"],
            ["依赖 agent 脱敏但无可用规格", "批次未带上/已吊销/已过期", "查 deidSpecs 下发与吊销名单", "退回内置弱脱敏"],
            ["回执摘要不符", "连路被改、agent 版本不一致", "核对 spec_sm3 与两侧摘要口径", "忽略摘要直接入库"],
            ["跨院配对结果为空", "对齐键缺失或被 subjectKey 冒充", "确认 CONNECTOR_ALIGNMENT_KEY/PURPOSE 与派生位置", "用院内假名当 linkKey"],
            ["国家节点互认 503", "未配置 ENDPOINT（生产即 fail-closed）", "配置端点或明确本阶段不对接", "在未对接时宣称已接入"],
        ],
        widths=[3.6, 4.2, 4.6, 3.4],
        caption="表 6-2　故障处置",
        font=8.5,
    )

    d.h2("6.3　轮换与吊销")
    d.bullet("平台三钥：按 DEPLOY §4.1 切换（新旧公钥并存期验签），回滚只需把切换顺序倒回。")
    d.bullet("连接器证书：平台重签 → 医院更新指纹与私钥 → 重启；旧证书进 CRL（拉模式生效）。")
    d.bullet("脱敏规格：改口径 = 新签一版（版本单调 +1）；出问题吊销该版，连接器下一批即清缓存。")
    d.bullet("词表：内容变更 = 新版本 + 平台重新签摘要；旧版本可吊销。")
    d.bullet("对齐密钥：换钥即换 kid，新数据用新值；历史值用 keyring 里的退役键复算，**不假装同名**。")
    d.bullet("算法模块：吊销名单版本单调下发，命中即清缓存并拒跑（不能靠缓存绕过）。")


def chapter_7(d: Doc) -> None:
    d.h1("7　合规边界与如实声明")

    d.table(
        ["声明", "口径"],
        [
            ["数据不出域", "指原始行级数据不离开医院控制边界；跨院 C2 密文信封仍属**数据出域/委托处理**（REG-08），需书面委托协议"],
            ["脱敏 ≠ 匿名化", "平台可保证口径统一、可审计、不可静默弱化；重识别风险按可复算报告评估（准标识 k / 直接标识残留 / 敏感列多样性），不宣称匿名"],
            ["对齐键 = 可控链接性", "持钥方可对可枚举标识空间离线枚举；缓解措施是密钥分发范围、用途分域、轮换与审计，不是加密本身"],
            ["机密计算口径", "无硬件节点时 attestationLevel 恒为 software；沙箱是能力受限而非进程隔离，不得向院方声称已具备 TEE"],
            ["与国家节点的能力边界", "丝路数港是区域功能节点（主体注册 + 身份互认 + 目录 + 审计），**不是**权威身份源；本空间密码学身份由自有 SM2 CA 负责"],
            ["存证归属", "自建长安链为当前形态；改由节点托管需确认写/读/背书三问后才调整采购清单"],
            ["外部依赖不抬高基线", "国家节点/外部服务不可用时，本地目录、任务、存证、脱敏一律照常；对外接口 fail-closed"],
        ],
        widths=[3.6, 12.2],
        caption="表 7-1　对外表述口径",
        font=8.5,
    )


def chapter_8(d: Doc) -> None:
    d.h1("8　附录")

    d.h2("8.1　端口表（节选，完整见 DEPLOY.md §1）")
    d.table(
        ["端口", "服务", "说明"],
        [
            ["5020", "medtrust-web", "Next.js 控制台"],
            ["5021", "medtrust-api", "NestJS 控制面 API + WS（前缀 /api/v1）"],
            ["5022", "连接器（NestJS）", "院内；管理面只绑 127.0.0.1"],
            ["5024", "院内 agent（Python）", "gRPC；仅院内网络，调用须带 x-agent-token"],
            ["8090", "ChainMaker 节点", "存证"],
            ["8200", "Vault", "密钥管理"],
            ["5432", "PostgreSQL 15", "平台/医院各自实例"],
            ["5032", "chat-agent", "对话式任务配置（可选）"],
        ],
        widths=[1.8, 5.0, 9.0],
        font=9,
    )

    d.h2("8.2　关键配置（分组，完整见 DEPLOY.md §2）")
    d.table(
        ["组", "变量（示例）", "用途"],
        [
            ["身份与鉴权", "CONNECTOR_PARTICIPANT_ID / CONNECTOR_CERT_FINGERPRINT / CONNECTOR_SM2_PRIVATE_KEY(_FILE) / AGENT_SHARED_TOKEN",
             "连接器身份、任务签名与 agent 调用鉴权"],
            ["平台公钥", "CONNECTOR_PLATFORM_NODE_PUBKEY / CONNECTOR_REGISTRY_PUBKEY / CONNECTOR_PLATFORM_CA_PUBKEY",
             "按用途验签（用错公钥即拒）"],
            ["数据源", "CONNECTOR_CDM_SOURCES(_FILE) / CONNECTOR_CDM_REVERIFY_MS", "CDM 接入声明与周期复核"],
            ["脱敏", "CONNECTOR_DEID_MODE / AGENT_DEID_SALTS_JSON / AGENT_DEID_DICTIONARY_DIR / AGENT_DEID_AUDIT_PATH",
             "builtin|agent 通道、盐、词表、审计链"],
            ["跨院对齐", "CONNECTOR_ALIGNMENT_KEY / CONNECTOR_ALIGNMENT_PURPOSE / CONNECTOR_ALIGNMENT_KEYRING", "对齐键派生与轮换"],
            ["国家节点", "SILKROAD_NODE_ENDPOINT / SILKROAD_NODE_ID / NDI_ORG_CODE / NDI_ID_SCHEME_VERSION", "互认与目录；缺配置 fail-closed"],
            ["平台密钥", "PLATFORM_KEK", "三把平台私钥的信封加密密钥（生产缺即拒启动）"],
        ],
        widths=[3.0, 8.4, 4.4],
        caption="表 8-1　关键配置分组",
        font=8.5,
    )

    d.h2("8.3　术语")
    d.table(
        ["术语", "解释"],
        [
            ["MDOP", "多域编排协议：平台按放置规则发片段、收 C3、合并与销毁编排"],
            ["PEP", "策略执行点：连接器内按合约四元组（主体/对象/目的/条件）逐步强制"],
            ["对齐键（linkKey）", "跨院同一主体可对齐的假名（lk_<kid>_<32hex>），由共管密钥 + 用途域派生"],
            ["院内假名（subjectKey）", "各院自有盐派生的院内标识，**不可跨院**"],
            ["C2 节点", "跨组织可信空间节点（飞地），中立第三方/监管侧，解密与计算在其中发生"],
            ["NDI", "国家数据基础设施；三统一指统一目录标识/身份/接口"],
        ],
        widths=[4.0, 11.8],
        font=9,
    )

    d.h2("8.4　依据文件与可机检校验")
    d.table(
        ["文件/命令", "作用"],
        [
            ["ARCHITECTURE.md §3 / §6", "总体架构与部署现状（唯一权威）"],
            ["DEPLOY.md §1–§4", "端口、环境变量、上线与回滚、踩坑速查"],
            ["docs/deploy/部署硬件需求-v2.md", "采购清单与可选项增量"],
            ["docs/omop-cdm-onboarding.md", "医院 DBA 视图层与接入校验"],
            ["docs/连接器部署安装步骤-内部运维.md", "跳板机、compose、加固、健康核验"],
            ["docs/丝路数港-接口对拍表.md", "国家节点接口方向、落点与状态"],
            ["node scripts/check-meta-docs.mjs", "八件套契约与代码对拍（实体/控制点/流程/决策）"],
            ["pnpm check:meta && pnpm governance", "合规与工厂 schema 校验"],
        ],
        widths=[7.0, 8.8],
        font=9,
    )

    d.para(
        "本文件为部署与评审材料，不替代上述权威契约；两者冲突时以契约与代码为准。",
        muted=True,
    )


def build(out: Path) -> None:
    d = Doc()
    footer(d.doc, "MedTrust 可信数据空间 · 三方交互架构与部署方案 v1.0 · 内部/评审用")
    cover(d)
    toc(d)
    chapter_1(d)
    d.page_break()
    chapter_2(d)
    d.page_break()
    chapter_3(d)
    d.page_break()
    chapter_4(d)
    d.page_break()
    chapter_5(d)
    d.page_break()
    chapter_6(d)
    d.page_break()
    chapter_7(d)
    d.page_break()
    chapter_8(d)
    d.save(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="docs/MedTrust-三方交互架构与部署方案-v1.0.docx",
        help="output docx path (relative to repo root)",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = Path(args.out)
    if not out.is_absolute():
        out = root / out
    build(out)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
