#!/usr/bin/env python3
"""对 `MedTrust-医疗AI基础设施平台-生态pptx.pptx` 做定向修订（可复跑）。

修订内容（用户 2026-10-08 需求）：
  1. 把三份场景 deck 的真实截图与信息并进生态 deck：
       · pitch/MedTrust-医疗可信数据空间-合作沟通.pptx
       · MedTrust-面向真实世界研究的可信空间解决方案.pptx
       · MedTrust-药物注册研究的可信空间解决方案.pptx
  2. P3「数据不动，计算动」改为与 TEE 实现一致的说法（密文进节点、节点内解密）。
  3. P4 核心底座按实现提炼：控制面 / 院内连接器 / 中立可信计算节点 / 审计与存证。
  4. 打通 P8→P9：场景不只 RWS，还有药物注册、疾控公卫、医学研究。
  5. 新增场景实测页（真机 3 · 线上 3 · 本机 2）与三页实证截图页、一页药物注册场景页。
  6. P13「公共卫生：终局场景」改为场景纵深（按付款方与已跑通证据组织）。

口径：沿用仓库既有事实边界（openspec/changes/tdx-attestation-pilot/external-claims.md），
全部数字取自来源 deck 与其证据文件，不新造结论。

运行：python3 scripts/patch-ecosystem-deck.py
"""
from __future__ import annotations

import os
import pathlib
import shutil

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt
from lxml import etree

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECK = pathlib.Path(os.environ.get(
    "ECO_DECK", ROOT / "MedTrust-医疗AI基础设施平台-生态pptx.pptx"))
BACKUP_DIR = ROOT / "pitch" / "archive"
BACKUP = BACKUP_DIR / "MedTrust-医疗AI基础设施平台-生态-原版-20261008.pptx"

SRC_COOP = ROOT / "pitch" / "MedTrust-医疗可信数据空间-合作沟通.pptx"

# ── 令牌（照抄生态 deck 自身）──────────────────────────────
DARK, DEEP, TEAL, ACCENT = "07242E", "0C3A47", "0F6E6A", "27C4B0"
BG, WHITE, MINT, LINE = "F4F7F7", "FFFFFF", "E4F1F1", "DAE6E6"
BAND = "E7F4F1"
T_TITLE_L, T_SUB_L = "07242E", "0F6E6A"
T_TITLE_D, T_SUB_D = "FFFFFF", "27C4B0"
T_BODY, T_BODY_D = "17303A", "D3E5E5"
T_MUTE = "5F787F"
AMBER, CHIP_D = "F2A93B", "BFF0E6"
INK_BAND = "0B5450"
FONT = "微软雅黑"
GX, GW = 0.62, 12.09
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def rgb(h):
    return RGBColor.from_string(h)


# ── 基础绘制 ────────────────────────────────────────────────
def _set_ea(run, name=FONT):
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", name)
        el.set("pitchFamily", "34")
        el.set("charset", "-122" if tag == "a:ea" else "-120")


def style_run(run, size, bold, color):
    f = run.font
    f.name = FONT
    f.size = Pt(size)
    f.bold = bold
    f.color.rgb = rgb(color)
    _set_ea(run)


def fill_text(shape, specs, anchor=None, spacing=1.18):
    """specs: [{"t":.., "s":pt, "b":bool, "c":hex, "align":..}]"""
    tf = shape.text_frame
    align = tf.paragraphs[0].alignment if tf.paragraphs else None
    tf.clear()
    for i, sp in enumerate(specs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = sp.get("align", align)
        p.line_spacing = sp.get("spacing", spacing)
        if sp.get("space_after"):
            p.space_after = Pt(sp["space_after"])
        r = p.add_run()
        r.text = sp["t"]
        style_run(r, sp.get("s", 11.5), sp.get("b", False), sp.get("c", T_BODY))
    if anchor is not None:
        tf.vertical_anchor = anchor
    return tf


def add_text(sl, x, y, w, h, specs, anchor=MSO_ANCHOR.TOP, spacing=1.18, wrap=True):
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.clear()
    for i, sp in enumerate(specs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = sp.get("align", PP_ALIGN.LEFT)
        p.line_spacing = sp.get("spacing", spacing)
        if sp.get("space_after"):
            p.space_after = Pt(sp["space_after"])
        r = p.add_run()
        r.text = sp["t"]
        style_run(r, sp.get("s", 11.5), sp.get("b", False), sp.get("c", T_BODY))
    return tb


def add_shape(sl, kind, x, y, w, h, fill=None, line=None, radius=None,
              shadow=False, line_w=1.0):
    sh = sl.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if kind == MSO_SHAPE.ROUNDED_RECTANGLE and radius is not None:
        try:
            sh.adjustments[0] = radius
        except Exception:
            pass
    if fill:
        sh.fill.solid()
        sh.fill.fore_color.rgb = rgb(fill)
    else:
        sh.fill.background()
    if line:
        sh.line.color.rgb = rgb(line)
        sh.line.width = Pt(line_w)
    else:
        sh.line.fill.background()
    sh.shadow.inherit = False
    if shadow:
        sh._element.spPr.append(etree.fromstring(
            f'<a:effectLst xmlns:a="{A_NS}"><a:outerShdw blurRad="114300" dist="38100" '
            f'dir="5400000" algn="bl" rotWithShape="0"><a:srgbClr val="0A2A33">'
            f'<a:alpha val="16000"/></a:srgbClr></a:outerShdw></a:effectLst>'))
    sh.text_frame.word_wrap = True
    return sh


def card(sl, x, y, w, h, radius=0.05, fill=WHITE, line=LINE, shadow=True):
    return add_shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h,
                     fill=fill, line=line, radius=radius, shadow=shadow)


def chip(sl, x, y, w, h, text, size=10.5, fill=BAND, color=INK_BAND):
    add_shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=fill, radius=0.28)
    add_text(sl, x, y, w, h, [{"t": text, "s": size, "b": True, "c": color,
                               "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)


def insight(sl, text, y=6.66, h=0.60, dark_text=INK_BAND):
    add_shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, GX, y, GW, h, fill=BAND, radius=0.15)
    add_shape(sl, MSO_SHAPE.OVAL, 0.84, y + 0.23, 0.14, 0.14, fill=ACCENT)
    add_text(sl, 1.12, y, GW - 0.70, h,
             [{"t": text, "s": 12, "b": True, "c": dark_text}],
             anchor=MSO_ANCHOR.MIDDLE)


def head(sl, title, sub, dark=False):
    add_text(sl, GX, 0.44, GW, 0.66,
             [{"t": title, "s": 29, "b": True, "c": T_TITLE_D if dark else T_TITLE_L}],
             anchor=MSO_ANCHOR.MIDDLE)
    add_text(sl, GX + 0.02, 1.12, GW, 0.44,
             [{"t": sub, "s": 14, "b": True, "c": T_SUB_D if dark else T_SUB_L}],
             anchor=MSO_ANCHOR.MIDDLE)


def new_slide(prs, dark=False):
    s = prs.slides.add_slide(prs.slide_layouts[0])
    f = s.background.fill
    f.solid()
    f.fore_color.rgb = rgb(DARK if dark else BG)
    return s


def stat_cards(sl, items, y=1.66, h=1.05, x0=GX, w=3.86, gap=0.20):
    for i, (big, label) in enumerate(items):
        x = x0 + i * (w + gap)
        card(sl, x, y, w, h)
        add_text(sl, x + 0.28, y + 0.14, w - 0.56, 0.46,
                 [{"t": big, "s": 24, "b": True, "c": TEAL}])
        add_text(sl, x + 0.28, y + 0.60, w - 0.56, 0.34,
                 [{"t": label, "s": 10.5, "b": False, "c": T_BODY}])


def shot(sl, img_path, x, y, w, aspect, caption=None, cap_w=None):
    h = w / aspect
    sl.shapes.add_picture(str(img_path), Inches(x), Inches(y), width=Inches(w))
    if caption:
        add_text(sl, x, y + h + 0.06, cap_w or w, 0.30,
                 [{"t": caption, "s": 9.5, "b": False, "c": T_MUTE}])
    return h


STATUS_COLOR = {"真机": TEAL, "线上": "9A6A12", "本机": T_MUTE,
                "试点期": T_MUTE, "沙盘": T_MUTE}


def styled_table(sl, x, y, w, col_w, rows, header_h=0.42, row_h=0.44, size=9.5,
                 status_col=True):
    gf = sl.shapes.add_table(len(rows), len(col_w), Inches(x), Inches(y),
                             Inches(w), Inches(header_h + row_h * (len(rows) - 1)))
    tbl = gf.table
    tbl.first_row = False
    tbl.horz_banding = False
    # 置为「无样式 · 表格网格」，颜色全部显式给
    tblPr = tbl._tbl.find(qn("a:tblPr"))
    if tblPr is None:
        tblPr = etree.SubElement(tbl._tbl, qn("a:tblPr"))
    for child in list(tblPr):
        tblPr.remove(child)
    sid = etree.SubElement(tblPr, qn("a:tableStyleId"))
    sid.text = "{5940675A-B579-460E-94D1-54222C63F5DA}"
    for i, cw in enumerate(col_w):
        tbl.columns[i].width = Inches(cw)
    for r, row in enumerate(rows):
        tbl.rows[r].height = Inches(header_h if r == 0 else row_h)
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.margin_left = cell.margin_right = Inches(0.07)
            cell.margin_top = cell.margin_bottom = Inches(0.02)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = rgb(DEEP if r == 0 else WHITE)
            tf = cell.text_frame
            tf.word_wrap = True
            tf.clear()
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.CENTER if (r == 0 or c == 0) else PP_ALIGN.LEFT
            run = p.add_run()
            run.text = val
            if r == 0:
                style_run(run, size + 0.5, True, WHITE)
            elif c == 0 and status_col:
                color = STATUS_COLOR.get(val, T_BODY)
                style_run(run, size, True, color)
            else:
                style_run(run, size, c == 1, T_BODY if c == 1 else T_MUTE)
    return tbl


def reorder(prs, order):
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    for el in ids:
        sldIdLst.remove(el)
    for i in order:
        sldIdLst.append(ids[i])


def clear_slide(sl, keep_texts):
    """保留标题/副标题（按整段文本精确识别），删除本页其余形状，便于整页重排。"""
    for sh in list(sl.shapes):
        keep = False
        if sh.has_text_frame:
            txt = sh.text_frame.text.strip()
            keep = any(txt == t for t in keep_texts)
        if not keep:
            sh._element.getparent().remove(sh._element)


def watermark(prs, text="苏州数说信息科技有限公司", size=32, angle=-30):
    """整本加水印：极淡的品牌文字，置于每页最底层（不遮挡内容）。

    深色页与浅色页分别取色，保证两边都只是"很淡"的一层。
    可用环境变量 ECO_NO_WATERMARK=1 跳过。
    """
    for sl in prs.slides:
        try:
            f = sl.background.fill
            bg = str(f.fore_color.rgb) if f.type == 1 else "F4F7F7"
        except Exception:
            bg = "F4F7F7"
        v = int(bg, 16)
        lum = ((v >> 16 & 0xFF) + (v >> 8 & 0xFF) + (v & 0xFF)) / 3
        dark = lum < 110
        color, alpha = ("4E7F83", 26) if dark else ("9FBABA", 18)
        tb = sl.shapes.add_textbox(Inches(1.67), Inches(3.15), Inches(10.0), Inches(1.20))
        tf = tb.text_frame
        tf.word_wrap = False
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = text
        style_run(run, size, True, color)
        clr = run._r.get_or_add_rPr().find(qn("a:solidFill")).find(qn("a:srgbClr"))
        node = clr.find(qn("a:alpha"))
        if node is None:
            node = etree.SubElement(clr, qn("a:alpha"))
        node.set("val", str(int(alpha * 1000)))
        tb.rotation = angle
        # 移到 Z 序最底层（紧跟 spTree 的 nvGrpSpPr / grpSpPr 之后）
        spTree = tb._element.getparent()
        spTree.remove(tb._element)
        spTree.insert(2, tb._element)


def flywheel(sl, cx, cy, r, node=0.42, ring_adj=0.08, hole_r=0.60,
             labels=("数据价值", "飞轮")):
    """环形飞轮：底环 + 6 节点 + 顺时针箭头 + 中心标签。"""
    R = r + 0.23              # 环外缘
    add_shape(sl, MSO_SHAPE.DONUT, cx - R, cy - R, 2 * R, 2 * R,
              fill=MINT, radius=None).adjustments[0] = ring_adj
    # 中心
    add_shape(sl, MSO_SHAPE.OVAL, cx - hole_r, cy - hole_r, 2 * hole_r, 2 * hole_r,
              fill=DEEP)
    add_text(sl, cx - hole_r, cy - hole_r, 2 * hole_r, 2 * hole_r,
             [{"t": labels[0], "s": 13, "b": True, "c": WHITE, "align": PP_ALIGN.CENTER},
              {"t": labels[1], "s": 13, "b": True, "c": WHITE, "align": PP_ALIGN.CENTER}],
             anchor=MSO_ANCHOR.MIDDLE)
    import math
    for k in range(6):
        th = math.radians(90 - 60 * k)
        x = cx + r * math.cos(th) - node / 2
        y = cy - r * math.sin(th) - node / 2
        add_shape(sl, MSO_SHAPE.OVAL, x, y, node, node,
                  fill=ACCENT if k % 2 == 0 else TEAL)
        add_text(sl, x, y, node, node,
                 [{"t": str(k + 1), "s": 13, "b": True,
                   "c": DARK, "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)
    for k in range(6):
        thm = math.radians(60 - 60 * k)
        x = cx + r * math.cos(thm) - 0.13
        y = cy - r * math.sin(thm) - 0.11
        tri = add_shape(sl, MSO_SHAPE.ISOSCELES_TRIANGLE, x, y, 0.26, 0.22, fill=ACCENT)
        tri.rotation = (180 - (60 - 60 * k)) % 360


def find_shape(sl, text):
    for sh in sl.shapes:
        if sh.has_text_frame and text in sh.text_frame.text:
            return sh
    raise KeyError(text)


def extract(src_path, slide_no, pic_index):
    """从来源 deck 抽出第 slide_no 页的第 pic_index 张图片（1 起）。"""
    prs = Presentation(str(src_path))
    s = prs.slides[slide_no - 1]
    pics = [sh for sh in s.shapes if sh.shape_type == 13]
    sh = pics[pic_index - 1]
    out = BUILD / f"{src_path.stem[:12]}-s{slide_no:02d}-{pic_index}.{sh.image.ext}"
    out.write_bytes(sh.image.blob)
    return out


BUILD = ROOT / ".cache" / "ecosystem-deck-patch"


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        shutil.copy2(DECK, BACKUP)

    img_attest = extract(SRC_COOP, 7, 1)     # 作业详情：分层计数 + 发布审查 + 回执链
    img_guest = extract(SRC_COOP, 9, 1)      # TDX 客户机内字节级实测
    img_cross = extract(SRC_COOP, 10, 1)     # 线上双中心任务详情（森林图）
    img_fl = extract(SRC_COOP, 11, 1)        # 线上联邦学习任务详情

    prs = Presentation(str(DECK))
    slides = list(prs.slides)

    # ── P3：修正「数据不动，计算动」──────────────────────────
    s3 = slides[2]
    fill_text(find_shape(s3, "数据不动，计算动"),
              [{"t": "明文不出院，密文进节点计算", "s": 13, "b": True, "c": WHITE}])
    fill_text(find_shape(s3, "数据始终留在医院"),
              [{"t": "原始记录在院内加密为最小投影后才出域；密文进入 TEE 节点，"
                     "核验证明后才释放密钥，只放行过闸聚合结果。",
                "s": 10.5, "b": False, "c": "C6DBDB"}])

    # ── P4：核心底座按实现提炼 ───────────────────────────────
    s4 = slides[3]
    fill_text(find_shape(s4, "临床辅助决策"),
              [{"t": "真实世界研究 RWS · 药物注册研究 · 医学研究协作 · 公共卫生监测",
                "s": 11.5, "b": False, "c": T_MUTE}])
    fill_text(find_shape(s4, "算力"), [{"t": "云资源 · Intel TDX 机型 · 至强 6 推理",
                                       "s": 11.5, "b": False, "c": T_MUTE}])
    # 侧栏标签收窄，右侧腾出四个底座板块
    lbl = find_shape(s4, "医疗数据可信空间层")
    lbl.width, lbl.height = Inches(2.55), Inches(0.82)
    fill_text(lbl, [{"t": "医疗数据可信空间层", "s": 13.5, "b": True, "c": WHITE},
                    {"t": "核心底座 · 实测已落地", "s": 10, "b": True, "c": "BFF0E6"}],
              anchor=MSO_ANCHOR.MIDDLE)
    old_body = find_shape(s4, "数据治理 · 授权流通")
    old_body._element.getparent().remove(old_body._element)
    blocks = [
        ("控制面", "身份目录 · 数字合约 · 作业编排"),
        ("院内连接器", "最小投影 · 策略执行 · 输出闸门"),
        ("中立可信计算节点", "TEE 机密计算 · 密钥释放"),
        ("审计与存证", "长安链存证 · 国密算法 · 回执链"),
    ]
    for i, (t, body) in enumerate(blocks):
        x = 3.95 + i * 2.20
        add_text(s4, x, 5.00, 2.10, 0.28, [{"t": t, "s": 10.5, "b": True, "c": WHITE}])
        add_text(s4, x, 5.28, 2.10, 0.44,
                 [{"t": body, "s": 8.5, "b": False, "c": "CFE6E6"}])

    # ── P8：三个闭环 → 接上四类场景 ──────────────────────────
    s8 = slides[7]
    fill_text(find_shape(s8, "技术闭环 × 合规闭环 × 商业闭环"),
              [{"t": "技术闭环 × 合规闭环 × 商业闭环 —— 同一套底座，四类场景都已跑通",
                "s": 14, "b": True, "c": T_SUB_D}])
    add_shape(s8, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 6.42, GW, 0.80,
              fill=DEEP, radius=0.12)
    for i, (t, body) in enumerate([
        ("真实世界研究 RWS", "疫苗保护效果 · 跨院去重发病率"),
        ("药物注册研究", "单臂外部对照 · 上市后安全监测"),
        ("疾控与公共卫生", "不良反应主动监测 · 疫情预警"),
        ("医学研究协作", "多中心队列 · 联邦学习预测"),
    ]):
        x = 0.92 + i * 2.97
        add_text(s8, x, 6.54, 2.80, 0.28, [{"t": t, "s": 11, "b": True, "c": ACCENT}])
        add_text(s8, x, 6.84, 2.80, 0.26, [{"t": body, "s": 9.5, "b": False, "c": "CFE6E6"}])

    # ── P9：RWS 流程 → 四类场景通用的可信协作流程 ─────────────
    s9 = slides[8]
    fill_text(find_shape(s9, "RWS 可信协作流程"),
              [{"t": "可信协作流程", "s": 29, "b": True, "c": T_TITLE_L}])
    fill_text(find_shape(s9, "数据不出院 · 连接器就地计算"),
              [{"t": "数据不出院 · 连接器产出最小投影 · 密文进 TEE 节点计算 · 只回传过闸聚合",
                "s": 14, "b": True, "c": T_SUB_L}])
    # 拆掉原「已跑通 / 当前阶段」深色块（含其中的文字与分隔线）
    for sh in list(s9.shapes):
        drop = False
        if sh.has_text_frame and any(k in sh.text_frame.text for k in
                                     ("已跑通的真实能力", "三种分析类型", "当前阶段",
                                      "Synthea", "下一步：接入真实付费")):
            drop = True
        elif sh.shape_type == 1 and sh.left is not None and abs(sh.top - Inches(3.66)) < 1000 \
                and abs(sh.left - Inches(0.62)) < 1000 and abs(sh.width - Inches(12.09)) < 1000:
            drop = True  # 0.62,3.66,12.09x2.24 的深色底
        elif sh.shape_type == 1 and sh.left is not None and sh.width is not None \
                and abs(sh.width) < 2000 and abs(sh.height - Inches(1.70)) < 1000:
            drop = True  # 8.52,4.00 的竖分隔线
        if drop:
            sh._element.getparent().remove(sh._element)
    scene_cards = [
        ("真实世界研究 RWS", "疫苗保护效果（TND）· 跨院去重发病率 · 多院联合登记", "真机已跑通"),
        ("药物注册研究", "单臂试验外部对照 · 罕见病自然史登记 · 上市后安全监测", "TDX 真机实测"),
        ("疾控与公共卫生", "疾控 × 医院不良反应主动监测 · 传染病早期预警", "真机全链路"),
        ("医学研究协作", "多中心队列与专病库 · 联邦学习风险预测", "线上双中心已跑通"),
    ]
    for i, (t, body, tag) in enumerate(scene_cards):
        x = GX + i * 3.06
        card(s9, x, 3.72, 2.90, 2.30)
        add_text(s9, x + 0.26, 3.94, 2.38, 0.34, [{"t": t, "s": 13.5, "b": True, "c": T_TITLE_L}])
        add_text(s9, x + 0.26, 4.36, 2.38, 1.05, [{"t": body, "s": 11, "b": False, "c": T_BODY}])
        chip(s9, x + 0.26, 5.58, 1.86, 0.30, tag, size=9.5)
    insight(s9, "换一个研究问题，只换「最小投影 + 签名算子 + 审查口径」——房间本身不变。", y=6.44, h=0.52)

    # ── 新增页 A：场景全景（全部场景，不只是近一周实测）────────
    sa = new_slide(prs)
    head(sa, "场景全景：10 类申报场景 + 2 类扩展",
         "四类场景族共用同一套底座；状态如实标注「真机 / 线上 / 本机 / 试点期开发 / 沙盘」")
    rows = [
        ["状态", "场景类别", "数据方 / 参与方", "当前证据与边界"],
        ["真机", "疫苗不良反应主动监测", "疾控 + 医院",
         "真机全链路实测 2 次 · 分层计数逐格一致 · 作业 PURGED、三方回执上链"],
        ["真机", "疫苗真实世界保护效果评估", "疾控 + 医院检验科",
         "TDX 真机客户机内实测 · 七层与答案键逐格一致（一层按约定「不可估」）"],
        ["真机", "跨院去重发病率与罕见病登记", "≥2 家医院 / 区域疾控",
         "TDX 真机客户机内实测 · 4038 + 3646 行 → 去重 6354 人"],
        ["本机", "耐药菌监测与跨院信号", "医院检验科 / 区域耐药网",
         "联邦耐药率、折点敏感性、罕见表型抑制三项 PASS；传播链分析列试点期专项"],
        ["线上", "药物警戒失衡信号", "多院药剂 / 药企安全部门",
         "线上单院 · PRR 1.29（1.12–1.48）、ROR 1.37 · 沙箱执行 + 阅后即焚"],
        ["线上", "跨中心比较效果与因果生存", "医院科研 / 药企医学部",
         "线上双中心 · 合并 OR 2.25（1.76–2.88）、I² 56% · 因果生存 L3 线上未跑"],
        ["线上", "联邦学习预测", "医院 / 模型使用方",
         "聚合 AUC 0.60（单轮、训练集内指标，不构成模型效果证据）"],
        ["本机", "合约期内分步查询", "数据持有方 / 使用方",
         "本机集成测试 10/10（含 5 类违规拦截、预算耗尽熔断）；真机未跑"],
        ["试点期", "传染病应报未报与报告时滞", "医院 / 疾控传报部门",
         "与主动监测同构，试点期开发，暂无运行实现"],
        ["试点期", "院感随访 · 孕产结局 · 死因补全", "医院 / 妇幼 / 死因登记",
         "同构复制模板，试点期开发，须先过伦理与合规闸门"],
        ["真机", "单臂试验外部对照（场景表之外）", "药企 / CRO",
         "TDX 真机客户机内实测 · 三层 RR 还原 0.52 / 0.52 / 0.58，负例层 1.15 覆盖 1"],
        ["沙盘", "国际多中心协作", "跨国药企 / 境内医院",
         "算法进来、数据不出境：只演示数据流与密钥境内控制，不涉真实跨境传输"],
    ]
    styled_table(sa, GX, 1.68, 12.09, [0.95, 2.85, 2.30, 5.99], rows,
                 header_h=0.36, row_h=0.36, size=9)
    insight(sa, "9 类已跑通（真机 4 · 线上 3 · 本机 2），3 类为储备（试点期开发 2 · 沙盘 1）；"
                "同一作业复跑结果逐格一致，提交到销毁 2 分 46 秒。", y=6.44, h=0.52)

    # ── 新增页 B：实证一（疫苗不良反应主动监测）───────────────
    sb = new_slide(prs)
    head(sb, "实证一：疫苗不良反应主动监测（疾控 × 医院）",
         "接种记录在疾控、就诊记录在医院；只比较同一个人两个时间窗内的事件数（自身对照设计）")
    stat_cards(sb, [("3 台", "云上 TDX 节点 + 独立网络域校验方"),
                    ("2 方", "疾控与医院各自核验节点会话证明"),
                    ("998–1000 区块", "三方回执链上链")], h=1.00)
    steps = [
        "两院各自本地完成七项复核，封存最小字段投影（接种日期 / 就诊日期 + 假名键）",
        "数据密钥各自托付给独立网络域的密钥保管方，平台不持有",
        "保管方验签节点真实证明（TDX · TCB 5.1.3）后，向节点释放会话密钥",
        "节点内执行算法模块：逐人算日期差并分层计数；发布审查 minCell=5、抑制 0 格",
        "制品销毁 → 作业 PURGED → 回执上链；数据持有方各自核验见证并留痕",
    ]
    for i, t in enumerate(steps):
        y = 2.86 + i * 0.62
        add_shape(sb, MSO_SHAPE.OVAL, GX + 0.06, y + 0.02, 0.42, 0.42, fill=TEAL)
        add_text(sb, GX + 0.06, y + 0.02, 0.42, 0.42,
                 [{"t": str(i + 1), "s": 13, "b": True, "c": WHITE,
                   "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)
        add_text(sb, GX + 0.68, y, 5.30, 0.56, [{"t": t, "s": 11, "b": False, "c": T_BODY}])
    shot(sb, img_attest, 6.74, 2.80, 5.80, 16 / 9,
         caption="作业详情页：会话证明 · 分层计数 · 发布审查 · 三方回执链上链", cap_w=5.80)
    insight(sb, "结果可核验：两方各自核验节点证明，平台只转发、不下结论。"
                "数据为合成数据、效应量人为注入，不构成真实风险结论；截图中机构名为演示占位。",
            y=6.44, h=0.52)

    # ── 新增页 C：实证二（TDX 客户机内字节级实测）──────────────
    sc = new_slide(prs)
    head(sc, "实证二：TDX 客户机内的字节级实测",
         "在机密虚拟机内执行生产用的算法模块，与事先算好的答案键逐格对拍")
    stat_cards(sc, [("七层", "疫苗保护效果评估与答案键逐格一致，一层按约定「不可估」"),
                    ("6354 人", "两院 4038 + 3646 行按人合并后的病例数"),
                    ("逐格一致", "与参考语义对拍，无人工调数")], h=1.00)
    bullets = [
        "真机环境事实：TDX 客户机检测、内存加密特性启用（实例 ID 与 IP 已隐去）",
        "证明链：真实 Quote 5006 字节 · REPORTDATA 前 32 字节 = sm3(环境公钥) · TCB 5.1.3",
        "节点内执行：模块字节取自节点本地模块库，逐层结果与答案键逐格一致",
        "同一节点、三类研究：TND 保护效果、跨院去重发病率与罕见病登记、单臂试验外部对照",
    ]
    for i, t in enumerate(bullets):
        y = 2.92 + i * 0.74
        add_shape(sc, MSO_SHAPE.OVAL, GX + 0.10, y + 0.09, 0.12, 0.12, fill=ACCENT)
        add_text(sc, GX + 0.42, y, 5.50, 0.68, [{"t": t, "s": 11, "b": False, "c": T_BODY}])
    add_text(sc, GX, 5.92, 5.90, 0.44,
             [{"t": "全部为合成数据与注入效应量，不构成任何真实流行病学或注册结论。",
               "s": 9.5, "b": False, "c": "9A6A12"}])
    shot(sc, img_guest, 6.90, 2.86, 4.05, 2646 / 2308)
    add_text(sc, 11.05, 2.86, 1.66, 0.60,
             [{"t": "TDX 客户机内实测日志", "s": 9.5, "b": True, "c": TEAL}])
    insight(sc, "在机密虚拟机里跑的是生产用的模块字节：同一节点、三份答案键，逐格一致。",
            y=6.44, h=0.52)

    # ── 新增页 D：实证三（双中心 + 联邦）───────────────────────
    sd = new_slide(prs)
    head(sd, "实证三：线上双中心比较效果与联邦学习",
         "跨中心合并原先被准入规则拦下；按正规流程补齐 k≥5 的预审组合与新合约后跑通")
    stat_cards(sd, [("合并 OR 2.25", "95% CI 1.76–2.88 · I² 56% · 上链区块 1010"),
                    ("两院各 5000 例", "甲院 + 乙院，控制面随机效应合并"),
                    ("聚合 AUC 0.60", "本地 0.611 / 0.585，权重不出院")], h=1.00)
    shot(sd, img_cross, GX, 2.86, 3.05, 4.82 / 5.05,
         caption="任务详情：连接器进度 · 随机效应合并与森林图")
    shot(sd, img_fl, 3.92, 2.86, 3.50, 3.71 / 2.55,
         caption="联邦任务详情：本地指标 · 聚合指标 · 模型哈希")
    add_text(sd, 3.92, 5.68, 3.50, 0.62,
             [{"t": "模型哈希与权重包存证在链；任务记录里能看到各方本地指标与聚合指标，"
                    "但不含任何一方患者的特征明细。", "s": 10, "b": False, "c": T_MUTE}])
    add_text(sd, 7.72, 2.86, 4.98, 2.30,
             [{"t": "· 两院在各自连接器内训练，控制面只做单轮聚合；出域的是模型增量，不是特征行",
               "s": 11, "b": False, "c": T_BODY, "spacing": 1.30},
              {"t": "· 聚合权重包经合约授权后在本地推理，患者特征不上送",
               "s": 11, "b": False, "c": T_BODY, "spacing": 1.30},
              {"t": "· 数据为合成数据、注入真值 HR 2.5；AUC 为训练集内指标（无留出集），"
                    "证明的是联邦训练链路在线上跑通，不是模型效果",
               "s": 11, "b": False, "c": "9A6A12", "spacing": 1.30}])
    insight(sd, "不该发生的确实没发生：未声明 k 的跨中心任务被准入闸门拒绝执行——"
                "闸门拒绝、输出抑制、撤销即停这些负向行为同样有据可查。", y=6.44, h=0.52)

    # ── 新增页 E：药物注册研究场景 ────────────────────────────
    se = new_slide(prs)
    head(se, "药物注册研究：把真实世界数据做成可评审的证据",
         "乐城注册路径下的四类研究，均已用 TDX 真机或客户机内实测跑通（合成数据）")
    reg_cards = [
        ("D1 单臂试验外部对照", "单臂 460 例 × 历史对照池 5600 例，节点内确定性窗口匹配"
                             "（caliper 30 天 · 1:2）",
         "三层 RR 还原 0.52 / 0.52 / 0.58（CI 不含 1），负例层 1.15（CI 覆盖 1）",
         "TDX 客户机内实测"),
        ("D2 罕见病登记与自然史", "两院上报直接相加会系统性高估：人头虚增约 +20%，"
                             "65 岁以上罕见病 +25%~33%",
         "按人合并后虚增消失；罕见病例数过少的层只隐藏该列，其余照常发布", "TDX 客户机内实测"),
        ("D3 上市后安全主动监测", "附条件批准的安全承诺研究：主动比对暴露与结局记录，"
                             "同一个人自身对照，个体混杂自动抵消",
         "高风险人群 RI 4.45（95% CI 2.71–7.39），注入信号被如实找出；发布审查 minCell=5",
         "真机全链路"),
        ("D4 国际多中心", "外方提交算子（可复现字节 + 国密摘要），中方数据密文进境内 TEE，"
                       "密钥境内保管、按证明释放",
         "只回传过审聚合结果与回执链，算法进来、数据不出境", "沙盘演示"),
    ]
    for i, (t, body, result, tag) in enumerate(reg_cards):
        x = GX + i * 3.06
        card(se, x, 1.70, 2.90, 3.60, fill=WHITE)
        add_text(se, x + 0.24, 1.86, 2.44, 0.40, [{"t": t, "s": 12.5, "b": True, "c": T_TITLE_L}])
        add_text(se, x + 0.24, 2.32, 2.44, 1.30, [{"t": body, "s": 10.5, "b": False, "c": T_BODY}])
        add_text(se, x + 0.24, 3.70, 2.44, 1.10, [{"t": result, "s": 10, "b": False, "c": TEAL}])
        chip(se, x + 0.24, 4.94, 1.90, 0.30, tag, size=9.5)
    add_shape(se, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 5.44, GW, 0.92, fill=DEEP, radius=0.12)
    add_text(se, 0.92, 5.56, 11.49, 0.30,
             [{"t": "审评三要素 → 技术能力对照", "s": 11.5, "b": True, "c": ACCENT}])
    add_text(se, 0.92, 5.86, 11.49, 0.42,
             [{"t": "真实性完整性 → OMOP CDM 标准化接入 + 逐记录溯源标记 + 答案键逐格对拍；"
                    "可溯源 → 全链回执上链，持公钥可离线独立核验；"
                    "受控使用 → 数字合约钉死字段与阈值 + 最小投影 + TEE 硬件隔离 + 双阈值发布审查。",
               "s": 10, "b": False, "c": "CFE6E6"}])
    insight(se, "边界：演示全部基于合成数据，不构成注册申报材料；真实数据接入需伦理与合规审批。",
            y=6.56, h=0.52)

    # ── P13：公共卫生「终局」→ 场景纵深 ───────────────────────
    s13 = slides[12]
    fill_text(find_shape(s13, "公共卫生：平台的终局场景"),
              [{"t": "场景纵深：从药企付费走到公共卫生", "s": 29, "b": True, "c": T_TITLE_D}])
    fill_text(find_shape(s13, "天然适配公共卫生"),
              [{"t": "药企与 CRO 是商业起点；疾控公卫与医学研究是同一套架构的自然延伸",
                "s": 14, "b": True, "c": T_SUB_D}])
    depth = [
        ("药物警戒与上市后安全", "付款方：药企 / CRO",
         "疫苗不良反应主动监测（自身对照 RI 4.45）· 单臂试验外部对照（三层 RR 还原）· "
         "院内沙箱失衡信号（PRR 1.29，单院）", "L1.5 失衡信号 · 沙箱执行"),
        ("跨中心疗效比较与联邦预测", "付款方：医院联盟 / 科研",
         "双中心比较效果合并 OR 2.25（I² 56%）· 联邦学习聚合 AUC 0.60，"
         "两院本地训练、权重不出院", "L2 Meta · L3 因果 · L4 联邦"),
        ("疾控与公共卫生监测", "付款方：疾控 / 监管",
         "疾控 × 医院疫苗不良反应主动监测（真机全链路）· 跨院去重发病率与罕见病登记"
         "（4038 + 3646 行 → 去重 6354 人）", "联邦异常检测 · 区域登记"),
    ]
    old_titles = ("传染病早期预警", "疫苗效力真实世界监测", "多中心药物疗效评估")
    old_bodies = ("多院哨点数据联邦聚合", "跨机构联合训练疫苗保护力预测模型", "院外 PSM 倾向性匹配")
    old_chips = ("L1.5 失谐信号检测", "L4 联邦学习预测", "L3 因果建模")
    for i, (t, payer, body, tag) in enumerate(depth):
        fill_text(find_shape(s13, old_titles[i]),
                  [{"t": t, "s": 14, "b": True, "c": WHITE},
                   {"t": payer, "s": 9.5, "b": False, "c": "9FBABA"}],
                  anchor=MSO_ANCHOR.TOP)
        fill_text(find_shape(s13, old_bodies[i]),
                  [{"t": body, "s": 11, "b": False, "c": T_BODY_D}])
        fill_text(find_shape(s13, old_chips[i]),
                  [{"t": tag, "s": 10.5, "b": True, "c": CHIP_D}])
    fill_text(find_shape(s13, "平台架构的通用性"),
              [{"t": "一套架构覆盖从商业到公共价值：药企付费验证商业闭环，"
                     "疾控与科研延伸平台纵深。", "s": 12, "b": True, "c": INK_BAND}])

    # ── P10 / P12：口径去 RWS 化（分析能力与底座不止服务 RWS）────
    ladder = slides[9]
    fill_text(find_shape(ladder, "不是「PPT 算法」"),
              [{"t": "不是「PPT 算法」：四类场景共用的分析能力", "s": 29, "b": True, "c": T_TITLE_D}])
    fill_text(find_shape(ladder, "RWS 阶梯 L1.5"),
              [{"t": "L1.5 – L4 每一层都是真实运行的统计 / 联邦引擎；RWS、药物注册、"
                     "疾控公卫、医学研究只在最小投影与算子上不同",
                "s": 14, "b": True, "c": T_SUB_D}])
    # 每层右侧标注证据状态，说明这是一页「能力」而不是某一个场景
    for key, tag in (("2×2 列联表", "真机与线上已跑"),
                     ("Mantel-Haenszel", "线上双中心已跑"),
                     ("PSM 最近邻匹配", "仅本机演示"),
                     ("PyTorch 多模态编码器", "线上已跑（单轮）")):
        box = find_shape(ladder, key)
        box.width = Inches(6.40)
        chip(ladder, 11.15, box.top / 914400 + 0.24, 1.45, 0.32, tag,
             size=9.5, fill="0B5450", color=CHIP_D)
    # 药企页：点明这是「商业化切入点」，而不是平台能力的适用范围
    wedge = slides[10]
    fill_text(find_shape(wedge, "药企优先：冷启动三步走"),
              [{"t": "商业化切入：药企优先的冷启动三步走", "s": 29, "b": True, "c": T_TITLE_L}])
    fill_text(find_shape(wedge, "药企付费意愿最强"),
              [{"t": "药企付费意愿最强 → 先用 RWS 服务跑通付费闭环 → "
                     "验证过的服务再复制到药物注册、疾控公卫与医学研究",
                "s": 14, "b": True, "c": T_SUB_L}])
    fill_text(find_shape(wedge, "6 个月内完成 0→1"),
              [{"t": "6 个月内完成 0→1：技术部署 → 医院闭环 → 药企签约；"
                     "先证伪、再滚网络，不空改产品。", "s": 12, "b": True, "c": INK_BAND}])
    fill_text(find_shape(slides[11], "可信数据空间 + RWS 协作"),
              [{"t": "可信数据空间 + 多中心协作 + 数据产品化，横向复用",
                "s": 14, "b": True, "c": T_SUB_L}])

    # ── P20：商业模式 · 数据价值飞轮（整页重排美化）────────────
    s20 = slides[14]      # 原「商业模式：数据价值飞轮」
    clear_slide(s20, ("商业模式：数据价值飞轮",
                      "医院提供数据 → 资产化 → 流通 → 产品 → 使用 → 收益回馈医院"))
    fill_text(find_shape(s20, "商业模式：数据价值飞轮"),
              [{"t": "商业模式：数据价值飞轮", "s": 29, "b": True, "c": T_TITLE_L}])
    fill_text(find_shape(s20, "医院提供数据"),
              [{"t": "医院提供数据 → 资产化 → 流通 → 产品 → 使用 → 收益回馈医院；"
                     "计价按「用途 × 交付形态」，不按条售卖原始数据",
                "s": 14, "b": True, "c": T_SUB_L}])
    card(s20, GX, 1.66, 4.80, 3.10)
    flywheel(s20, 3.02, 3.21, 1.05)
    card(s20, 5.62, 1.66, 2.86, 3.10)
    add_text(s20, 5.86, 1.80, 2.40, 0.28,
             [{"t": "六步闭环", "s": 12, "b": True, "c": TEAL}])
    for i, t in enumerate(("医院提供数据", "数据资产化", "数据流通",
                           "模型与数据产品", "药企 / AI 企业使用", "收益回馈医院")):
        y = 2.16 + i * 0.42
        add_shape(s20, MSO_SHAPE.OVAL, 5.86, y, 0.28, 0.28,
                  fill=ACCENT if i % 2 == 0 else TEAL)
        add_text(s20, 5.86, y, 0.28, 0.28,
                 [{"t": str(i + 1), "s": 9.5, "b": True, "c": DARK,
                   "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)
        add_text(s20, 6.24, y - 0.02, 2.10, 0.34,
                 [{"t": t, "s": 10.5, "b": False, "c": T_BODY}], anchor=MSO_ANCHOR.MIDDLE)
    card(s20, 8.68, 1.66, 4.03, 3.10)
    add_text(s20, 8.92, 1.80, 3.60, 0.28,
             [{"t": "收入模型（示例结构）", "s": 12, "b": True, "c": TEAL}])
    cd = CategoryChartData()
    cd.categories = ["控制面 SaaS 订阅", "按任务计费", "连接器部署运维", "数据资产分账"]
    cd.add_series("收入结构", (35, 30, 20, 15))
    gf = s20.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(9.70), Inches(2.06),
                              Inches(2.00), Inches(2.00), cd)
    ch = gf.chart
    ch.has_title = False
    ch.has_legend = False
    plot = ch.plots[0]
    try:
        plot.doughnut_hole_size = 62
    except Exception:
        pass
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.show_value = True
    dl.show_percentage = False
    dl.number_format = '0"%"'
    dl.number_format_is_linked = False
    dl.font.size = Pt(10)
    dl.font.bold = True
    dl.font.color.rgb = rgb(WHITE)
    for pt_, color, label_color in zip(plot.series[0].points,
                                       (TEAL, ACCENT, AMBER, DEEP),
                                       (WHITE, DARK, DARK, WHITE)):
        pt_.format.fill.solid()
        pt_.format.fill.fore_color.rgb = rgb(color)
        pt_.data_label.font.size = Pt(10)
        pt_.data_label.font.bold = True
        pt_.data_label.font.color.rgb = rgb(label_color)
        pt_.data_label.number_format = '0"%"'
        pt_.data_label.number_format_is_linked = False
    for i, (t, c) in enumerate((("控制面 SaaS 订阅 35%", TEAL), ("按任务计费 30%", TEAL),
                                ("连接器部署运维 20%", "0B5450"), ("数据资产分账 15%", "0B5450"))):
        x = 8.92 + (i % 2) * 1.95
        y = 4.10 + (i // 2) * 0.26
        add_text(s20, x, y, 1.90, 0.24, [{"t": t, "s": 9.5, "b": True, "c": c}],
                 anchor=MSO_ANCHOR.MIDDLE)
    card(s20, GX, 4.90, GW, 1.44)
    add_text(s20, 0.92, 5.02, 3.00, 0.28,
             [{"t": "计价与分配", "s": 12, "b": True, "c": TEAL}])
    for i, (t, body) in enumerate((
            ("计价单元", "按「用途 × 交付形态」计费：仅聚合结果 / 仅模型 / 合约期内多次查询；"
                         "不按条售卖原始数据。"),
            ("分配顺序", "平台运营与安全成本 → 数据提供方贡献分成 → 场景与服务方分成 → 公共回馈。"),
            ("现状边界", "分账为台账口径，尚无真实支付结算；收入规模以实际签约为准。"))):
        x = 0.92 + i * 3.94
        add_text(s20, x, 5.36, 3.60, 0.26, [{"t": t, "s": 11, "b": True, "c": T_TITLE_L}])
        add_text(s20, x, 5.62, 3.62, 0.64, [{"t": body, "s": 10, "b": False, "c": T_BODY}])
    insight(s20, "医院侧收益来自分成台账与合规凭证，而不是卖出病历；"
                 "计价单元由合约钉死，分配结果上链可查。", y=6.44, h=0.52)

    # ── P21：网络效应 × 合规壁垒 —— 补新版 GCP（ICH E6(R3)）要求 ──
    s21 = slides[15]      # 原「三重网络效应 × 合规壁垒」
    clear_slide(s21, ("三重网络效应 × 合规壁垒",
                      "核心竞争力不是单项技术，而是可信枢纽位置 + 抄不走的网络沉淀"))
    fill_text(find_shape(s21, "三重网络效应 × 合规壁垒"),
              [{"t": "三重网络效应 × 合规壁垒", "s": 29, "b": True, "c": T_TITLE_L}])
    fill_text(find_shape(s21, "核心竞争力不是单项技术"),
              [{"t": "护城河是可信枢纽位置 + 网络沉淀；合规侧对齐新版 GCP（ICH E6(R3)）"
                     "与 ICH 方法学要求", "s": 14, "b": True, "c": T_SUB_L}])
    add_shape(s21, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 1.66, 5.90, 2.60,
              fill=DARK, radius=0.05)
    add_text(s21, 0.92, 1.80, 5.00, 0.34,
             [{"t": "三重网络效应", "s": 14, "b": True, "c": ACCENT}])
    for i, (t, sub) in enumerate((
            ("医院接入 → 更多医院 → 数据沉淀", "正反馈飞轮，越接越厚"),
            ("数据沉淀 → 模型能力 → 客户价值", "数据资产驱动模型迭代"),
            ("模型能力 → 吸引更多参与方", "网络效应自增强"))):
        y = 2.26 + i * 0.68
        add_shape(s21, MSO_SHAPE.OVAL, 0.94, y + 0.02, 0.34, 0.34, fill=ACCENT)
        add_text(s21, 0.94, y + 0.02, 0.34, 0.34,
                 [{"t": str(i + 1), "s": 11, "b": True, "c": DARK,
                   "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)
        add_text(s21, 1.42, y, 4.90, 0.32, [{"t": t, "s": 12.5, "b": True, "c": WHITE}])
        add_text(s21, 1.42, y + 0.32, 4.90, 0.26, [{"t": sub, "s": 9.5, "b": False, "c": "9FBABA"}])
    for i, (t, body) in enumerate((
            ("数据安全审查准入", "卫健委 + 网信办双重审查，准入资质形成天然壁垒"),
            ("数字合约审计链", "上链存证 + 全链路审计，流程复杂度构成壁垒"),
            ("政策卡位 2024–2027", "先行者卡位标准制定，后入者被迫跟随"))):
        y = 1.66 + i * 0.90
        card(s21, 6.82, y, 5.89, 0.80)
        add_shape(s21, MSO_SHAPE.OVAL, 7.06, y + 0.17, 0.46, 0.46,
                  fill=AMBER if i != 1 else TEAL)
        add_text(s21, 7.06, y + 0.17, 0.46, 0.46,
                 [{"t": str(i + 1), "s": 13, "b": True, "c": WHITE,
                   "align": PP_ALIGN.CENTER}], anchor=MSO_ANCHOR.MIDDLE)
        add_text(s21, 7.70, y + 0.10, 4.80, 0.30, [{"t": t, "s": 13, "b": True, "c": T_TITLE_L}])
        add_text(s21, 7.70, y + 0.42, 4.80, 0.30, [{"t": body, "s": 10.5, "b": False, "c": T_BODY}])
    card(s21, GX, 4.40, GW, 1.66)
    add_text(s21, 0.92, 4.52, 8.00, 0.28,
             [{"t": "新版 GCP（ICH E6(R3)）与 ICH 方法学要求 → 我们的承载与缺口",
               "s": 12, "b": True, "c": TEAL}])
    for i, (t, color, items) in enumerate((
            ("已承载 · 可机检", TEAL, ("方案版本与修订留痕（E6(R3)）",
                                    "统计计划 α / 效能 / 样本量 / 多重性（E9）",
                                    "多中心异质性随合并结论报告（E9 §5.5）")),
            ("部分承载 · 有闸门", "9A6A12", ("缺失值机制与填补策略声明（E9(R1)）",
                                        "敏感性分析预先声明（执行器未接线，闸门拒收）",
                                        "因果方法选型：IV / G 方法未实现")),
            ("申报前必须补齐 · 缺口", T_MUTE, ("数据治理与 ALCOA+ 正式声明",
                                          "计算机化系统验证（E6(R3) / GAMP 5）",
                                          "电子记录与签名（Part 11 / Annex 11）")))):
        x = 0.92 + i * 3.94
        add_text(s21, x, 4.82, 3.62, 0.24, [{"t": t, "s": 10.5, "b": True, "c": color}])
        for j, it in enumerate(items):
            add_text(s21, x, 5.08 + j * 0.23, 3.62, 0.23,
                     [{"t": "· " + it, "s": 9.5, "b": False, "c": T_BODY}])
    add_text(s21, 0.92, 5.80, 11.49, 0.24,
             [{"t": "承载项均有对应字段或闸门；缺口项属申报前必须补齐，不对外声称已具备。"
                    "CDISC SDTM / ADaM 导出与源数据可核查性方案同列缺口。",
               "s": 9.5, "b": False, "c": T_MUTE}])
    add_shape(s21, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 6.16, GW, 0.62,
              fill=BAND, radius=0.15)
    add_text(s21, 0.92, 6.16, 11.49, 0.62,
             [{"t": "政策窗口：2024.01 财政部「AI+医疗」· 2025.10 五部门数据资源入表 · "
                    "2026.06 国家数据局 25 号文 · 2026.07 国务院「十五五」规划 —— "
                    "2024–2027 卡位。", "s": 10.5, "b": True, "c": INK_BAND}],
             anchor=MSO_ANCHOR.MIDDLE)

    # 顺序：机制（流程）→ 能力（分析阶梯）→ 实证 → 商业
    n = len(slides)
    order = (list(range(9))                       # 1–9 封面…可信协作流程
             + [9]                                # 10 分析能力阶梯（原「不是 PPT 算法」）
             + [n, n + 1, n + 2, n + 3, n + 4]    # 11–15 实测总览 + 三页实证 + 药物注册
             + list(range(10, n)))                 # 16–22 药企切入…演进路线
    reorder(prs, order)

    # 全本水印（很淡；ECO_NO_WATERMARK=1 可跳过）
    if os.environ.get("ECO_NO_WATERMARK") != "1":
        watermark(prs)

    prs.save(str(DECK))
    print(f"saved {DECK}")
    print(f"slides: {len(prs.slides)}")
    print(f"backup: {BACKUP}")


if __name__ == "__main__":
    main()
