#!/usr/bin/env python3
"""Build the editable RWD registration report DOCX from canonical JSON."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageChops, ImageDraw, ImageFont


BLACK = RGBColor(0, 0, 0)
BLUE = "1F4E79"
PALE_BLUE = "EAF1F8"
GRAY = "D9D9D9"
WHITE = RGBColor(255, 255, 255)
FONT_ASCII = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_CJK = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color: str = GRAY) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_cell_margin(cell, top=90, start=100, bottom=90, end=100) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    mar = tc_pr.first_child_found_in("w:tcMar")
    if mar is None:
        mar = OxmlElement("w:tcMar")
        tc_pr.append(mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = OxmlElement(f"w:{name}")
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")
        mar.append(node)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def set_row_cant_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def set_run_font(run, size: float, bold: bool = False, color=BLACK) -> None:
    run.font.name = "Arial"
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Arial Unicode MS")
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("    Page ")
    set_run_font(run, 8.5)
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    paragraph._p.append(field)


def add_table(doc, headers, rows, widths=None, font_size=8.5):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    header = table.rows[0]
    set_repeat_table_header(header)
    for index, value in enumerate(headers):
        cell = header.cells[index]
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, BLUE)
        set_cell_border(cell)
        set_cell_margin(cell)
        if widths:
            cell.width = Inches(widths[index])
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = paragraph.add_run(str(value))
        set_run_font(run, font_size, bold=True, color=WHITE)
    set_row_cant_split(header)
    for row_index, row in enumerate(rows):
        added_row = table.add_row()
        set_row_cant_split(added_row)
        cells = added_row.cells
        for index, value in enumerate(row):
            cell = cells[index]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_border(cell)
            set_cell_margin(cell)
            if widths:
                cell.width = Inches(widths[index])
            if row_index % 2 == 1:
                set_cell_shading(cell, PALE_BLUE)
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.alignment = (
                WD_ALIGN_PARAGRAPH.CENTER
                if index == 0 and len(str(value)) <= 18
                else WD_ALIGN_PARAGRAPH.LEFT
            )
            run = paragraph.add_run(str(value))
            set_run_font(run, font_size)
    doc.add_paragraph()
    return table


def add_heading(doc, text, level=1):
    paragraph = doc.add_heading(level=level)
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.space_before = Pt(14 if level == 1 else 9)
    paragraph.paragraph_format.space_after = Pt(5)
    run = paragraph.add_run(text)
    set_run_font(run, 15 if level == 1 else 11.5, bold=True, color=BLACK)
    return paragraph


def add_body(doc, text, bold_lead=None):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(6)
    paragraph.paragraph_format.line_spacing = 1.16
    if bold_lead:
        run = paragraph.add_run(bold_lead)
        set_run_font(run, 10.5, bold=True)
    run = paragraph.add_run(text)
    set_run_font(run, 10.5)
    return paragraph


def add_caption(doc, text):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(9)
    run = paragraph.add_run(text)
    set_run_font(run, 8.5)
    run.font.italic = True
    run.font.color.rgb = RGBColor(70, 70, 70)


def font(size: int, bold: bool = False):
    path = FONT_CJK if Path(FONT_CJK).exists() else FONT_ASCII
    return ImageFont.truetype(path, size=size, index=0)


def chart_canvas(title, subtitle):
    image = Image.new("RGB", (1400, 760), "white")
    draw = ImageDraw.Draw(image)
    draw.text((58, 42), title, fill="#0f172a", font=font(34, True))
    draw.text((58, 90), subtitle, fill="#475569", font=font(20))
    return image, draw


def save_chart(image: Image.Image, path: Path) -> None:
    background = Image.new("RGB", image.size, "white")
    diff = ImageChops.difference(image, background)
    box = diff.getbbox()
    if box:
        pad = 22
        image = image.crop(
            (
                max(0, box[0] - pad),
                max(0, box[1] - pad),
                min(image.width, box[2] + pad),
                min(image.height, box[3] + pad),
            )
        )
    image.save(path)


def remove_paragraph_border(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    border = p_pr.find(qn("w:pBdr"))
    if border is not None:
        p_pr.remove(border)
    border = OxmlElement("w:pBdr")
    for edge in ("top", "left", "bottom", "right", "between", "bar"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "nil")
        border.append(node)
    p_pr.append(border)


def render_chart_pngs(report, out_dir: Path) -> list[tuple[Path, str]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    charts: list[tuple[Path, str]] = []
    balance = report["diagnostics"]["balance"]
    image, draw = chart_canvas(
        "Figure 1  Standardized mean differences",
        "Before weighting and after IPTW-ATT weighting",
    )
    max_val = max(0.2, *(abs(row[key]) for row in balance for key in ("smdBefore", "smdAfter")))
    scale = 930 / (max_val * 1.12)
    for index, row in enumerate(balance):
        y = 220 + index * 115
        draw.text((70, y - 11), row["covariate"], fill="#0f172a", font=font(22))
        draw.rectangle((340, y - 24, 340 + abs(row["smdBefore"]) * scale, y - 8), fill="#94a3b8")
        draw.rectangle((340, y, 340 + abs(row["smdAfter"]) * scale, y + 16), fill="#2563eb")
        draw.text((360 + abs(row["smdBefore"]) * scale, y - 30), f'{row["smdBefore"]:.3f}', fill="#475569", font=font(17))
        draw.text((360 + abs(row["smdAfter"]) * scale, y - 4), f'{row["smdAfter"]:.3f}', fill="#1d4ed8", font=font(17))
    path = out_dir / "balance-smd.png"
    save_chart(image, path)
    charts.append((path, "Weighted balance by prespecified covariates"))

    image, draw = chart_canvas(
        "Figure 2  Cohort flow",
        "Synthetic source and analysis populations",
    )
    cohort = report["cohort"]
    boxes = [
        (80, 220, 360, 120, "Trial source", cohort["trialN"]),
        (80, 470, 360, 120, "Control pool", cohort["controlPoolN"]),
        (740, 220, 360, 120, "Analysis trial", cohort["analysisTrialN"]),
        (740, 470, 360, 120, "Analysis control", cohort["analysisControlN"]),
    ]
    for x, y, w, h, label, value in boxes:
        draw.rounded_rectangle((x, y, x + w, y + h), radius=18, fill="#f8fafc", outline="#2563eb", width=3)
        draw.text((x + 24, y + 22), label, fill="#334155", font=font(20))
        draw.text((x + 24, y + 58), f"{value:,}", fill="#0f172a", font=font(32, True))
    for y in (280, 530):
        draw.line((440, y, 720, y), fill="#64748b", width=4)
        draw.polygon([(720, y), (695, y - 12), (695, y + 12)], fill="#64748b")
    exclusions = "; ".join(f'{row["reason"]}: {row["count"]}' for row in cohort["exclusions"])
    draw.text((520, 390), exclusions, fill="#475569", font=font(18))
    path = out_dir / "cohort-flow.png"
    save_chart(image, path)
    charts.append((path, "Source cohort and final analysis cohort"))

    image, draw = chart_canvas(
        "Figure 3  Propensity-score overlap",
        "Strict common-support region used by the estimator",
    )
    overlap = report["diagnostics"]["overlap"]
    draw.line((100, 310, 1290, 310), fill="#cbd5e1", width=18)
    draw.line(
        (100 + overlap["minPropensity"] * 1190, 310, 100 + overlap["maxPropensity"] * 1190, 310),
        fill="#2563eb",
        width=18,
    )
    draw.text((100, 355), "0", fill="#475569", font=font(19))
    draw.text((1265, 355), "1", fill="#475569", font=font(19))
    draw.text(
        (100, 440),
        f'Range {overlap["minPropensity"]:.3f} to {overlap["maxPropensity"]:.3f}   Trimmed {overlap["trimmed"]}',
        fill="#0f172a",
        font=font(22),
    )
    path = out_dir / "overlap-propensity.png"
    save_chart(image, path)
    charts.append((path, "Estimated propensity-score overlap"))

    image, draw = chart_canvas(
        "Figure 4  Weight diagnostics",
        "Maximum, 99th percentile and effective sample size",
    )
    weights = report["diagnostics"]["weights"]
    maximum = max(weights["maxWeight"], weights["p99Weight"], 1)
    for index, (label, value, color) in enumerate(
        [
            ("P99", weights["p99Weight"], "#d97706"),
            ("Maximum", weights["maxWeight"], "#dc2626"),
        ]
    ):
        x = 150 + value / maximum * 980
        draw.line((x, 210, x, 390), fill=color, width=7)
        draw.text((x - 26, 410), label, fill=color, font=font(19, True))
        draw.text((x - 32, 442), f"{value:.2f}", fill="#0f172a", font=font(18))
    draw.text(
        (150, 530),
        f'Truncated fraction {weights["truncatedFraction"]:.3f}   Effective sample size {weights["effectiveSampleSize"]:.1f}',
        fill="#334155",
        font=font(22),
    )
    path = out_dir / "weight-diagnostics.png"
    save_chart(image, path)
    charts.append((path, "Untruncated and truncated weight diagnostics"))

    image, draw = chart_canvas(
        "Figure 5  Primary and sensitivity risk ratios",
        "Point estimates and 95 percent confidence intervals",
    )
    estimates = [
        ("Primary", report["result"]["riskRatio"], report["result"]["riskRatioCi"]),
        *[
            (row["id"], row["estimate"], [row["ciLow"], row["ciHigh"]])
            for row in report["sensitivity"]
        ],
    ]
    low = min(item[2][0] for item in estimates) - 0.05
    high = max(item[2][1] for item in estimates) + 0.05
    x_of = lambda value: 360 + (value - low) / (high - low) * 870
    draw.line((x_of(1), 170, x_of(1), 610), fill="#dc2626", width=3)
    for index, (label, estimate, interval) in enumerate(estimates):
        y = 230 + index * 120
        draw.text((70, y - 15), label, fill="#0f172a", font=font(21))
        draw.line((x_of(interval[0]), y, x_of(interval[1]), y), fill="#334155", width=5)
        draw.ellipse((x_of(estimate) - 10, y - 10, x_of(estimate) + 10, y + 10), fill="#2563eb")
        draw.text((x_of(interval[1]) + 12, y - 14), f"{estimate:.3f}", fill="#334155", font=font(18))
    path = out_dir / "effect-forest.png"
    save_chart(image, path)
    charts.append((path, "Primary and prespecified sensitivity analyses"))

    image, draw = chart_canvas(
        "Figure 6  Primary and secondary source comparison",
        "Effect estimates from independent external-control projections",
    )
    hetero = report["heterogeneity"]
    values = [
        ("Primary source", hetero["primaryRr"], "#2563eb"),
        (
            "Secondary source",
            hetero["secondaryRr"],
            "#64748b",
        ),
    ]
    for index, (label, value, color) in enumerate(values):
        y = 240 + index * 150
        draw.text((70, y - 20), label, fill="#0f172a", font=font(22))
        if value is None:
            draw.text((360, y - 16), "Not available", fill="#64748b", font=font(21))
        else:
            draw.rectangle((360, y - 26, 360 + value * 650, y + 26), fill=color)
            draw.text((380 + value * 650, y - 18), f"{value:.3f}", fill="#0f172a", font=font(24, True))
    draw.text((70, 560), hetero["conclusion"], fill="#334155", font=font(22))
    path = out_dir / "source-comparison.png"
    save_chart(image, path)
    charts.append((path, "Primary versus secondary external-control estimates"))
    return charts


def render_screenshot_fixtures(report, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = []
    steps = report["assistantSession"]["screenshots"]
    for screenshot in steps:
        path = out_dir / f'{screenshot["stepId"]}.png'
        image = Image.new("RGB", (1600, 900), "#f8fafc")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 1600, 92), fill="#0f172a")
        draw.text((44, 27), "MedTrust  AI Assistant  ·  SIMULATION ONLY", fill="white", font=font(28, True))
        draw.rounded_rectangle((120, 150, 1480, 770), radius=24, fill="white", outline="#cbd5e1", width=3)
        draw.text((170, 200), f'{screenshot["stepId"]}  {screenshot["title"]}', fill="#0f172a", font=font(34, True))
        draw.text((170, 260), screenshot["assistantMessageId"], fill="#475569", font=font(21))
        draw.text((170, 305), f'Tool: {screenshot["toolName"]}', fill="#334155", font=font(21))
        backend = json.dumps(screenshot["backendResource"], ensure_ascii=False)
        draw.text((170, 350), f"Backend resource: {backend}", fill="#334155", font=font(20))
        if screenshot["stepId"] == "A01":
            draw.text((170, 450), "Demo account: demo@example.invalid", fill="#0f172a", font=font(24))
            draw.text((170, 500), "Demo password: demo-simulation-only", fill="#0f172a", font=font(24))
            draw.text((170, 575), "Fictional credentials only. No production identity.", fill="#9a3412", font=font(22, True))
        else:
            draw.text((170, 470), "Deterministic assistant card", fill="#1d4ed8", font=font(28, True))
            draw.text((170, 530), screenshot["cardType"].upper(), fill="#475569", font=font(22))
            draw.text((170, 595), "All identifiers and outcomes come from registered tools.", fill="#334155", font=font(21))
        path = out_dir / f'{screenshot["stepId"]}.png'
        image.save(path)
        generated.append(path)
    return generated


def build(input_dir: Path, output: Path) -> Path:
    report = json.loads((input_dir / "registration-report.json").read_text())
    work = output.parent / f".{output.stem}-assets"
    charts = render_chart_pngs(report, work / "charts")
    screenshots = render_screenshot_fixtures(report, work / "screenshots")

    doc = Document()
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.72)
    section.bottom_margin = Inches(0.72)
    section.left_margin = Inches(0.78)
    section.right_margin = Inches(0.78)

    styles = doc.styles
    styles["Normal"].font.name = "Arial"
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial Unicode MS")
    styles["Normal"].font.size = Pt(10.5)
    for name in ("Title", "Subtitle", "Heading 1", "Heading 2"):
        style = styles[name]
        style.font.name = "Arial"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial Unicode MS")
        style.font.color.rgb = BLACK
        style.font.bold = name != "Subtitle"
        style.font.size = Pt(25 if name == "Title" else 12)

    header = section.header.paragraphs[0]
    header.text = ""
    run = header.add_run("SIMULATION ONLY  |  RWD registration report  |  NOT REGULATORY EVIDENCE")
    set_run_font(run, 8, bold=True)
    header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer = section.footer.paragraphs[0]
    footer.text = ""
    set_run_font(footer.add_run("SIMULATION ONLY  ·  " + report["reportFingerprint"]), 7.5)
    add_page_number(footer)

    title = doc.add_paragraph(style="Title")
    remove_paragraph_border(title)
    title.paragraph_format.space_before = Pt(80)
    title.paragraph_format.space_after = Pt(14)
    set_run_font(title.add_run("RWD 单臂外部对照注册研究报告（模拟）"), 25, bold=True)
    subtitle = doc.add_paragraph(style="Subtitle")
    remove_paragraph_border(subtitle)
    subtitle.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_run_font(
        subtitle.add_run("一项基于固定合成输入的可追溯方法学演练"),
        13,
        color=BLACK,
    )
    doc.add_paragraph()
    add_body(
        doc,
        "本报告说明注册研究的外部对照设计、ATT estimand、统计方法、合成真值恢复、执行证据与 AI 助手交互审计链。所有数字来自 canonical registration-report.json；本报告不构成临床、安全性或监管结论。",
    )
    doc.add_paragraph()
    add_table(
        doc,
        ["Document field", "Value"],
        [
            ["Study", report["study"]["studyId"]],
            ["Product", report["study"]["product"]],
            ["Indication", report["study"]["indication"]],
            ["Schema / version", f'{report["schema"]} / {report["reportVersion"]}'],
            ["Report fingerprint", report["reportFingerprint"]],
            ["Independent review", report["independentReview"]["verdict"]],
        ],
        widths=[1.9, 4.7],
    )
    doc.add_page_break()

    add_heading(doc, "Contents", 1)
    for item in [
        "1  Executive summary",
        "2  Study design and estimand",
        "3  Data sources and contracts",
        "4  Statistical methods",
        "5  Results and diagnostics",
        "6  Sensitivity, truth recovery and bias",
        "7  Execution evidence",
        "8  AI assistant audit trail",
        "9  A01-A10 screenshot appendix",
    ]:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(5)
        set_run_font(paragraph.add_run(item), 10.5)

    add_heading(doc, "1  Executive summary", 1)
    add_body(
        doc,
        f'主分析为 ATT {report["estimand"]["summaryMeasure"]}，风险比为 {report["result"]["riskRatio"]:.3f}（95% CI {report["result"]["riskRatioCi"][0]:.3f}-{report["result"]["riskRatioCi"][1]:.3f}）。加权后最大绝对 SMD 为 {max(abs(row["smdAfter"]) for row in report["diagnostics"]["balance"]):.3f}，有效样本量为 {report["diagnostics"]["weights"]["effectiveSampleSize"]:.1f}。',
    )
    add_body(
        doc,
        "合成真值恢复、独立统计复核、合约绑定与回执链状态均来自报告 JSON。任何缺失或失败条件都会阻止成功报告生成。",
    )
    add_table(
        doc,
        ["Check", "Result"],
        [
            ["Synthetic boundary", "SIMULATION ONLY"],
            ["Truth recovery", "PASS" if report["truthRecovery"]["withinExpectedRange"] else "FAIL"],
            ["Independent review", report["independentReview"]["verdict"].upper()],
            ["Receipt chains", "VALID" if report["execution"]["chainsValid"] else "INVALID"],
        ],
        widths=[3.2, 3.4],
    )

    add_heading(doc, "2  Study design and estimand", 1)
    add_table(
        doc,
        ["Design element", "Specification"],
        [
            ["Population", report["targetTrial"]["population"]],
            ["Trial strategy", report["targetTrial"]["treatmentStrategies"]["trial"]],
            ["External-control strategy", report["targetTrial"]["treatmentStrategies"]["externalControl"]],
            ["Time zero", report["targetTrial"]["timeZero"]],
            ["Follow-up", report["targetTrial"]["followUp"]],
            ["Outcome", report["targetTrial"]["outcome"]],
            ["Intercurrent events", report["targetTrial"]["intercurrentEvents"]],
            ["Estimand", report["estimand"]["type"]],
            ["Summary measure", report["estimand"]["summaryMeasure"]],
        ],
        widths=[2.15, 4.45],
    )

    add_heading(doc, "3  Data sources and contracts", 1)
    add_table(
        doc,
        ["Role", "Participant", "Data product", "Contract", "Version"],
        [
            [
                row["role"],
                row["participantId"],
                row["dataProductId"],
                row["contractId"],
                row["sourceVersion"],
            ]
            for row in report["sources"]
        ],
        widths=[1.35, 1.05, 1.15, 1.35, 0.85],
        font_size=7.8,
    )
    add_body(
        doc,
        f'Protocol {report["protocol"]["protocolVersion"]} and SAP {report["protocol"]["sapVersion"]} are bound by SHA-compatible digests recorded in the canonical JSON. Each source uses a separate contract.',
    )

    add_heading(doc, "4  Statistical methods", 1)
    add_body(
        doc,
        f'Propensity model: {report["methods"]["propensityModel"]}. Covariates: {", ".join(report["methods"]["covariates"])}. Trim bounds: {report["methods"]["trimLow"]:.2f} to {report["methods"]["trimHigh"]:.2f}.',
    )
    add_body(doc, report["methods"]["missingPlan"], "Missing data. ")
    add_body(doc, report["methods"]["censoringPlan"], "Censoring. ")
    add_body(doc, "; ".join(report["methods"]["failClosedRules"]), "Fail-closed rules. ")

    add_heading(doc, "5  Results and diagnostics", 1)
    for chart, caption in charts[:4]:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.keep_with_next = True
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run().add_picture(str(chart), width=Inches(6.25))
        add_caption(doc, caption)
    add_table(
        doc,
        ["Metric", "Estimate", "Lower 95% CL", "Upper 95% CL"],
        [
            ["Trial risk", f'{report["result"]["riskTreated"]:.3f}', "-", "-"],
            ["Control risk", f'{report["result"]["riskControl"]:.3f}', "-", "-"],
            ["Risk difference", f'{report["result"]["riskDifference"]:.3f}', f'{report["result"]["riskDifferenceCi"][0]:.3f}', f'{report["result"]["riskDifferenceCi"][1]:.3f}'],
            ["Risk ratio", f'{report["result"]["riskRatio"]:.3f}', f'{report["result"]["riskRatioCi"][0]:.3f}', f'{report["result"]["riskRatioCi"][1]:.3f}'],
        ],
        widths=[2.0, 1.4, 1.5, 1.5],
    )

    add_heading(doc, "6  Sensitivity, truth recovery and bias", 1)
    for chart, caption in charts[4:]:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.keep_with_next = True
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run().add_picture(str(chart), width=Inches(6.25))
        add_caption(doc, caption)
    add_table(
        doc,
        ["Analysis", "Estimate", "95% CI", "Direction"],
        [
            [
                row["id"],
                f'{row["estimate"]:.3f}',
                f'{row["ciLow"]:.3f}-{row["ciHigh"]:.3f}',
                row["direction"],
            ]
            for row in report["sensitivity"]
        ],
        widths=[2.15, 1.15, 1.55, 1.55],
    )
    add_body(
        doc,
        f'Injected truth RR {report["truthRecovery"]["truthRr"]:.3f}; adjusted {report["truthRecovery"]["adjustedRr"]:.3f}; crude {report["truthRecovery"]["crudeRr"]:.3f}. Adjusted absolute error {report["truthRecovery"]["adjustedAbsoluteError"]:.3f}.',
        "Truth recovery. ",
    )
    add_body(
        doc,
        f'{report["bias"]["negativeControl"]}. {report["bias"]["quantitativeBias"]}.',
        "Bias controls. ",
    )

    add_heading(doc, "7  Execution evidence", 1)
    add_table(
        doc,
        ["Evidence field", "Value"],
        [
            ["Job", report["execution"]["jobId"]],
            ["Logical plan hash", report["execution"]["logicalPlanHash"]],
            ["Plan hash", report["execution"]["planHash"]],
            ["Operator", report["execution"]["operatorRef"]],
            ["Operator digest", report["execution"]["operatorSm3"]],
            ["TEE policy", report["execution"]["teePolicy"]],
            ["Evidence manifest", report["evidence"]["evidenceManifestDigest"]],
            ["Answer key digest", report["truthRecovery"]["answerKeyDigest"]],
        ],
        widths=[2.2, 4.4],
        font_size=7.8,
    )

    doc.add_page_break()
    add_heading(doc, "8  AI assistant audit trail", 1)
    add_body(
        doc,
        "Every post-login business step is represented by a deterministic card and bound to a message, tool call, screenshot digest and backend resource. The report excludes raw rows and row-level identifiers.",
    )
    add_table(
        doc,
        ["Step", "Message", "Tool", "Credential display"],
        [
            [
                row["stepId"],
                row["assistantMessageId"],
                row["toolName"],
                row["credentialDisplay"],
            ]
            for row in report["assistantSession"]["screenshots"]
        ],
        widths=[0.55, 1.1, 2.95, 1.05],
        font_size=7.2,
    )

    doc.add_page_break()
    add_heading(doc, "9  A01-A10 screenshot appendix", 1)
    for index, (screenshot, image_path) in enumerate(zip(report["assistantSession"]["screenshots"], screenshots), start=7):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.keep_with_next = True
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run().add_picture(str(image_path), width=Inches(6.15))
        add_caption(
            doc,
            f'Figure {index}  {screenshot["stepId"]} {screenshot["title"]}  |  SHA-256 {screenshot["screenshotSha256"][:16]}...',
        )

    add_heading(doc, "Report boundary", 1)
    add_body(
        doc,
        "SIMULATION ONLY. This report is not clinical evidence, regulatory advice, approval, or a statement of product efficacy or safety. A real study requires new identifiers, validated source data, executed contracts, qualified review and applicable regulatory authorization.",
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Directory containing registration-report.json")
    parser.add_argument("--out", required=True, help="Output DOCX path")
    args = parser.parse_args()
    output = build(Path(args.input).resolve(), Path(args.out).resolve())
    print(output)


if __name__ == "__main__":
    main()
