#!/usr/bin/env python3
"""生成「医疗可信数据空间 · 技术底座与真实落地」合作沟通 PPT。

**设计权威 = `MedTrust-医疗AI基础设施平台-路演_副本.pptx`**（逐值照抄，不凭感觉）：
  背景 F4F7F7（内容页）/ 07242E（封面·分节）
  标题 29pt bold 07242E（@0.62,0.44,12.09,0.66）；副标题 14.5pt 0F6E6A（@0.64,1.12,12.09,0.44）
  卡片 roundRect 白底 3.86×1.56，列距 4.06，行距 1.72→3.44
  圆形图标 0.58in，0F6E6A（白字）/ 27C4B0（深字）交替
  卡片标题 13.5pt 07242E；卡片正文 11pt 17303A
  层次条 白底 0.70 高、距 0.81、起始 y1.66；标签 13.5pt 17303A @x+0.32；右侧 11.5pt 5F787F
  高亮条 0F6E6A 高 0.82，左标 15pt 白 + 右文 12.5pt E4F1F1 + 琥珀圆点 F2A93B 0.24
  封面：品牌 12pt 6FD8C9 / 标题 44pt 白 / 副题 15pt BFD6D6 / 三胶囊 0C3A47 2.80×0.92 / 琥珀 tagline 17pt F2A93B
  字体统一 微软雅黑；**正文最小 11pt，注释最小 9.5pt**

内容口径：只讲我方判断/技术/真实落地与「合作基础」，**不含任何申报信息**。
运行数据与截图取自 docs/申报书/证明材料/（2026-10-07 实测；合成数据，边界如实标注）。
"""
from __future__ import annotations

import pathlib

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_TICK_MARK
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = pathlib.Path(__file__).resolve().parent.parent
EV = ROOT / "docs" / "申报书" / "证明材料"
OUT = ROOT / "pitch" / "MedTrust-医疗可信数据空间-合作沟通.pptx"

# ── 令牌（照抄参考件）──
DARK = "07242E"; DEEP = "0C3A47"; TEAL = "0F6E6A"; ACCENT = "27C4B0"
BG = "F4F7F7"; WHITE = "FFFFFF"; MINT = "E4F1F1"; LINE = "E2EAEA"
T_TITLE = "07242E"; T_SUB = "0F6E6A"; T_CARD = "07242E"; T_BODY = "17303A"; T_MUTE = "5F787F"
AMBER = "F2A93B"; FOOT = "9BAEAE"; BRAND = "6FD8C9"
FONT = "微软雅黑"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
GX, GW = 0.62, 12.09
PAGE = {"n": 0}


def rgb(h): return RGBColor.from_string(h)


def slide(prs, dark=False):
    s = prs.slides.add_slide(prs.slide_layouts[0])
    PAGE["n"] += 1
    bg = s.background.fill
    bg.solid(); bg.fore_color.rgb = rgb(DARK if dark else BG)
    return s


def shape(sl, kind, x, y, w, h, fill=None, line=None, radius=0.05, shadow=False, lw=1.0):
    sh = sl.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if kind == MSO_SHAPE.ROUNDED_RECTANGLE and radius is not None:
        try: sh.adjustments[0] = radius
        except Exception: pass
    if fill: sh.fill.solid(); sh.fill.fore_color.rgb = rgb(fill)
    else: sh.fill.background()
    if line: sh.line.color.rgb = rgb(line); sh.line.width = Pt(lw)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    if shadow:
        sh._element.spPr.append(etree.fromstring(
            f'<a:effectLst xmlns:a="{A}"><a:outerShdw blurRad="101600" dist="25400" dir="5400000" '
            f'algn="bl" rotWithShape="0"><a:srgbClr val="0A2A33"><a:alpha val="14000"/></a:srgbClr>'
            f'</a:outerShdw></a:effectLst>'))
    sh.text_frame.word_wrap = True
    return sh


def text(sl, x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=1.18):
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    plist = paras if paras and isinstance(paras[0], list) else [paras]
    for i, para in enumerate(plist):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = spacing
        for t, sz, bold, color in para:
            r = p.add_run(); r.text = t
            r.font.size = Pt(sz); r.font.bold = bold
            r.font.color.rgb = rgb(color); r.font.name = FONT
    return tb


def head(sl, title, sub=None, dark=False):
    text(sl, GX, 0.44, GW, 0.66, [(title, 29, True, WHITE if dark else T_TITLE)])
    if sub:
        text(sl, 0.64, 1.12, GW, 0.44, [(sub, 14.5, False, ACCENT if dark else T_SUB)])


def foot(sl, dark=False, label="医疗可信数据空间 · 苏州数说信息科技"):
    text(sl, GX, 6.98, 9.0, 0.3, [(label, 9, False, "6E8C8C" if dark else FOOT)])
    text(sl, 11.5, 6.98, 1.2, 0.3, [(f"{PAGE['n']:02d}", 9, True, "6E8C8C" if dark else FOOT)],
         align=PP_ALIGN.RIGHT)


def circle_chip(sl, x, y, ch, teal=True, size=0.58):
    shape(sl, MSO_SHAPE.OVAL, x, y, size, size, fill=TEAL if teal else ACCENT)
    text(sl, x, y + size / 2 - 0.17, size, 0.34, [(ch, 17, False, WHITE if teal else DARK)],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def card(sl, x, y, head_t, body, ch=None, teal=True, w=3.86, h=1.56):
    shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=WHITE, radius=0.05, shadow=True)
    if ch:
        circle_chip(sl, x + 0.26, y + 0.26, ch, teal=teal)
        text(sl, x + 0.98, y + 0.28, w - 1.24, 0.50, [(head_t, 13.5, True, T_CARD)])
    else:
        text(sl, x + 0.26, y + 0.28, w - 0.52, 0.50, [(head_t, 13.5, True, T_CARD)])
    text(sl, x + 0.26, y + 0.90, w - 0.52, h - 1.02, [(body, 11, False, T_BODY)], spacing=1.2)


def row_strip(sl, y, label, detail, h=0.70, highlight=False):
    if highlight:
        shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, GX, y, GW, h, fill=TEAL, radius=0.06, shadow=True)
        shape(sl, MSO_SHAPE.OVAL, GX + 0.30, y + h / 2 - 0.12, 0.24, 0.24, fill=AMBER)
        text(sl, GX + 0.72, y, 5.20, h, [(label, 15, True, WHITE)], anchor=MSO_ANCHOR.MIDDLE)
        text(sl, GX + 5.70, y, 6.09, h, [(detail, 12.5, False, MINT)], anchor=MSO_ANCHOR.MIDDLE, spacing=1.15)
    else:
        shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, GX, y, GW, h, fill=WHITE, radius=0.06, shadow=True)
        text(sl, GX + 0.32, y, 5.20, h, [(label, 13.5, True, T_BODY)], anchor=MSO_ANCHOR.MIDDLE)
        text(sl, GX + 5.70, y, 6.09, h, [(detail, 11.5, False, T_MUTE)], anchor=MSO_ANCHOR.MIDDLE, spacing=1.15)


def band(sl, y, chips, title, h=1.02):
    """底部技术栈带：照抄参考件（0F6E.. 容器 07242E，标题 12.5pt 27C4B0，胶囊 0C3A47/CFE6E6 10.5pt）"""
    shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, GX, y, GW, h, fill=DARK, radius=0.05)
    text(sl, GX + 0.30, y + 0.14, 3.2, 0.34, [(title, 12.5, True, ACCENT)])
    cx = GX + 0.28
    for c in chips:
        wch = 0.30 + 0.115 * len(c)
        shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, cx, y + 0.52, wch, 0.36, fill=DEEP, radius=0.2)
        text(sl, cx, y + 0.56, wch, 0.30, [(c, 10.5, False, "CFE6E6")], align=PP_ALIGN.CENTER)
        cx += wch + 0.14


def kpi(sl, x, y, w, h, value, label, unit="", vs=26):
    shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=WHITE, radius=0.06, shadow=True)
    shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, 0.07, h, fill=ACCENT, radius=0.5)
    text(sl, x + 0.28, y + 0.14, w - 0.5, 0.5, [(value, vs, True, DEEP), (unit, 12, True, TEAL)])
    text(sl, x + 0.28, y + h - 0.46, w - 0.5, 0.38, [(label, 11, False, T_MUTE)], spacing=1.12)


def _resolved(rel: str) -> pathlib.Path:
    """优先取 screenshots-deck/ 下已脱敏（演示机构名占位化）的副本。"""
    masked = EV / "screenshots-deck" / pathlib.Path(rel).name
    if masked.exists():
        return masked
    return EV / rel


def shot(sl, rel, x, y, w, h, caption=None, fs=10, badge=None):
    path = _resolved(rel)
    iw, ih = Image.open(path).size
    sc = min(w / iw, h / ih)
    pw, ph = iw * sc, ih * sc
    px, py = x + (w - pw) / 2, y + (h - ph) / 2
    shape(sl, MSO_SHAPE.ROUNDED_RECTANGLE, px - 0.035, py - 0.035, pw + 0.07, ph + 0.07,
          fill=None, line=LINE, radius=0.02, shadow=True)
    sl.shapes.add_picture(str(path), Inches(px), Inches(py), Inches(pw), Inches(ph))
    if badge:
        shape(sl, MSO_SHAPE.OVAL, px - 0.16, py - 0.16, 0.40, 0.40, fill=AMBER)
        text(sl, px - 0.16, py - 0.02, 0.40, 0.32, [(badge, 12, True, DARK)], align=PP_ALIGN.CENTER)
    if caption:
        text(sl, x, y + h + 0.06, w, 0.32, [(caption, fs, False, T_MUTE)], spacing=1.1,
             align=PP_ALIGN.CENTER)


def bars(sl, x, y, w, h, cats, vals, colors, num_fmt='0.000', title=None, maxs=None):
    cd = CategoryChartData(); cd.categories = cats; cd.add_series("值", tuple(vals))
    gf = sl.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), cd)
    ch = gf.chart
    ch.has_legend = False
    ch.font.size = Pt(11); ch.font.name = FONT; ch.font.color.rgb = rgb(T_BODY)
    pl = ch.plots[0]; pl.gap_width = 90; pl.has_data_labels = True
    dl = pl.data_labels; dl.number_format = num_fmt; dl.number_format_is_linked = False
    dl.font.size = Pt(12); dl.font.bold = True; dl.font.color.rgb = rgb(DEEP)
    for i, pt in enumerate(pl.series[0].points):
        pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(colors[i % len(colors)])
    ca = ch.category_axis; ca.has_major_gridlines = False
    ca.major_tick_mark = XL_TICK_MARK.NONE; ca.format.line.color.rgb = rgb(LINE)
    ca.tick_labels.font.size = Pt(11)
    va = ch.value_axis; va.has_major_gridlines = False; va.visible = False
    va.minimum_scale = 0; va.maximum_scale = maxs if maxs else max(vals) * 1.3
    if title:
        ch.has_title = True; ch.chart_title.text_frame.text = title
        r = ch.chart_title.text_frame.paragraphs[0].runs[0]
        r.font.size = Pt(11.5); r.font.name = FONT; r.font.color.rgb = rgb(T_MUTE); r.font.bold = False
    return ch


def donut(sl, x, y, w, h, cats, vals, colors):
    cd = CategoryChartData(); cd.categories = cats; cd.add_series("场景数", tuple(vals))
    gf = sl.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(x), Inches(y), Inches(w), Inches(h), cd)
    ch = gf.chart; ch.has_legend = False; ch.font.size = Pt(11.5); ch.font.name = FONT
    pl = ch.plots[0]; pl.has_data_labels = True
    dl = pl.data_labels; dl.show_percentage = False; dl.show_value = True
    dl.font.size = Pt(14); dl.font.bold = True; dl.font.color.rgb = rgb(WHITE)
    for i, pt in enumerate(pl.series[0].points):
        pt.format.fill.solid(); pt.format.fill.fore_color.rgb = rgb(colors[i % len(colors)])
    return ch


def cover(prs):
    s = slide(prs, dark=True)
    for (x1, y1, x2, y2) in [(11.9, 1.0, 12.5, 1.7), (12.5, 1.7, 12.2, 2.6), (12.2, 2.6, 11.0, 2.95),
                             (11.0, 2.95, 12.6, 3.55), (12.6, 3.55, 11.6, 3.9), (11.6, 3.9, 12.4, 4.3)]:
        c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
        c.line.color.rgb = rgb(TEAL); c.line.width = Pt(1)
    for i, (dx, dy) in enumerate([(11.61, 0.81), (12.41, 1.61), (10.81, 1.81), (12.01, 2.81), (10.91, 3.21), (12.61, 3.51)]):
        shape(s, MSO_SHAPE.OVAL, dx, dy, 0.18, 0.18, fill=ACCENT if i % 2 else TEAL)
    text(s, 0.62, 1.05, 8.0, 0.30, [("苏州数说信息科技有限公司", 12, False, BRAND)])
    text(s, 0.62, 1.70, 11.4, 2.0,
         [[("医疗可信数据空间", 44, True, WHITE)], [("驱动的多中心数据协作底座", 44, True, WHITE)]], spacing=1.02)
    text(s, 0.62, 3.95, 10.8, 0.70,
         [("数据不动、计算动：明文不出院 · 只出过闸聚合 · 硬件证明通过才释放密钥 · 全流程可核验", 15, False, "BFD6D6")])
    for i, (t1, t2) in enumerate([("真实运行", "Real Runs"), ("多中心协作", "Multi-center"), ("可核验证据", "Verifiable")]):
        x = 0.62 + i * 3.05
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, 4.90, 2.80, 0.92, fill=DEEP, radius=0.08)
        text(s, x + 0.25, 5.02, 2.40, 0.40, [(t1, 16, True, WHITE)])
        text(s, x + 0.25, 5.42, 2.40, 0.32, [(t2, 11, False, ACCENT)])
    ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(GX), Inches(6.55), Inches(GX + GW), Inches(6.55))
    ln.line.color.rgb = rgb("1E4A55"); ln.line.width = Pt(1)
    text(s, GX, 6.70, 9.0, 0.40, [("敬请指正 · 2026-10", 17, False, AMBER)])


def main():
    prs = Presentation(); prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)

    cover(prs)

    # 02 我们的判断
    s = slide(prs); head(s, "我们的判断：医疗数据流通卡在四个地方",
                         "不是算力不够，也不是模型不行 —— 是「谁都不敢先把数据交出去」")
    for i, (lab, det) in enumerate([
            ("不敢流通", "合规与伦理风险高，数据出域即越线；机构宁愿数据沉睡，也不愿承担不可逆后果"),
            ("不能协同", "关键问题要逐人跨机构连接：暴露在一家、结局在另一家，接种在疾控、就诊在医院"),
            ("协同也难用", "跨机构口径不一，简单相加即重复计数；缺少统一的数据产品形态与计价方式"),
            ("缺规则缺基建", "主管部门难以验证「数据真的没出域」，合规审查缺抓手，机构间缺少可执行的使用控制")]):
        row_strip(s, 1.66 + i * 0.81, lab, det)
    row_strip(s, 5.15, "共同点", "答案不是「把数据集中起来」，而是让计算去数据那里，并让监管能验证它确实没拿走数据",
              h=0.82, highlight=True)
    foot(s)

    # 03 关键判断
    s = slide(prs); head(s, "关键判断：这类问题只能「逐人纵向连接」",
                         "为什么明文汇聚、只出统计表的联邦汇总、通用多方安全计算都不够")
    quad = [("明文汇聚", "把两院行级数据拉到一处 —— 触碰合规与伦理红线，不能作为方案", "越线"),
            ("只出统计表的联邦汇总", "风险期计数取决于每人「就诊日 − 接种日」，不是任何一方局部统计量的函数", "算不出"),
            ("通用多方安全计算", "隐私求交 + 逐对比较日期 + 分层计数；换个时间窗就要重做协议，且要求各方同时在线", "不划算"),
            ("中立可信计算节点", "数据以密文进入、只在节点内解开、只放出聚合结果；换口径只改算法模块，不改协议", "可行")]
    for i, (h_, b_, tag) in enumerate(quad):
        x = GX + (i % 2) * 6.13; y = 1.72 + (i // 2) * 2.06
        hl = i == 3
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, 5.96, 1.86, fill=TEAL if hl else WHITE, radius=0.05, shadow=True)
        text(s, x + 0.30, y + 0.24, 3.6, 0.44, [(h_, 15, True, WHITE if hl else T_CARD)])
        tw = 0.42 + 0.16 * len(tag)
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x + 5.96 - 0.30 - tw, y + 0.26, tw, 0.42,
              fill=ACCENT if hl else BG, radius=0.3)
        text(s, x + 5.96 - 0.30 - tw, y + 0.31, tw, 0.34, [(tag, 11.5, True, DARK)], align=PP_ALIGN.CENTER)
        text(s, x + 0.30, y + 0.86, 5.36, 0.86, [(b_, 12, False, MINT if hl else T_BODY)], spacing=1.25)
    text(s, GX, 6.02, GW, 0.5,
         [("代价与对策：", 12, True, TEAL),
          ("信任锚从「机构自律」换成「硬件证明 + 被度量的代码 + 密钥释放分离」，并让数据持有方各自核验证明 —— 平台只转发，不下结论。",
           12, False, T_BODY)])
    foot(s)

    # 04 平台架构
    s = slide(prs); head(s, "平台架构：瘦控制面 + 重连接器 + 中立可信计算节点",
                         "同一套架构既做「数据不出院的协同计算」，也做「必须明文会合的节点内计算」")
    row_strip(s, 1.66, "控制面（平台侧）", "身份与目录 · 数字合约与使用控制 · 作业编排 · 结算台账 · 存证与审计")
    row_strip(s, 2.47, "院内连接器（数据持有方）", "本地接入与去标识 · 最小字段投影 · 策略执行点 · 沙箱化算法 · 输出闸门")
    row_strip(s, 3.28, "中立可信计算节点（第三方运营）", "机密虚拟机 · 密封语料 · 会话证明 · 发布审查 · 制品销毁",
              h=0.82, highlight=True)
    row_strip(s, 4.31, "审计与存证", "合约、作业回执、销毁回执上链；审计链式哈希 + 完整性校验，可按哈希读链查验")
    band(s, 5.30, ["原始行级数据不进控制面", "平台对密文只转运不解密", "出域必须过闸", "作业结束即销毁并回执"], "三条不变量")
    foot(s)

    # 05 六项技术能力
    s = slide(prs); head(s, "六项技术能力：把合规要求做成可执行的工程约束",
                         "不是「制度 PDF + 人工自觉」，而是运行时强制、可机检、可复核")
    caps = [("密", "国密身份与信任链", "参与方与连接器持 SM2 证书；通道与摘要 SM3；密文信封 SM4；吊销可查"),
            ("约", "数字合约与使用控制", "用途、字段、算法、输出阈值写入合约；执行点全路径强制，撤销即停"),
            ("算", "可复现算法模块", "算法以模块入库，摘要国密对拍、构建配方可复现；第三方模块须准入"),
            ("闸", "输出闸门", "默认最小单元格抑制，罕见病/罕见表型双阈值；不合规结果不出域"),
            ("证", "存证与审计", "合约、作业与销毁回执上链；审计链式哈希，可按哈希读链查验"),
            ("证", "机密计算与远程证明", "云上 TDX 实测：证明 → 密钥释放 → 节点内计算 → 发布审查 → 销毁")]
    for i, (ch, t, b) in enumerate(caps):
        card(s, GX + (i % 3) * 4.06, 1.72 + (i // 3) * 1.72, t, b, ch=ch, teal=(i % 2 == 1))
    band(s, 5.30, ["国密 SM2 / SM3 / SM4", "NDI-TR-2025", "TC609 评价规范", "Wasm + SM3 指纹"], "标准与实现对齐")
    foot(s)

    # 06 真实落地总览
    s = slide(prs); head(s, "真实落地：近一周跑过的场景与运行方式",
                         "2026-10-07 实测 · 全部使用合成数据 · 如实区分「真机 / 线上 / 本机」")
    donut(s, 0.42, 1.55, 4.30, 4.30, ["真机", "线上", "本机"], [3, 3, 2], [ACCENT, TEAL, AMBER])
    text(s, 0.72, 5.70, 3.9, 1.1,
         [[("真机 3 · 线上 3 · 本机 2", 12, True, DEEP)],
          [("「本机」= 编排代码真实但未在真机或线上跑；「线上」跑在院内连接器的软件执行环境里，不涉及 TDX。",
            10, False, T_MUTE)]], spacing=1.2)
    items = [("① 疫苗不良反应主动监测", "真机全链路 · 分层计数与期望值逐格一致 · 作业 PURGED · 三方回执上链"),
             ("② 疫苗保护效果评估", "真机 · TDX 客户机内执行真实模块字节 · 七层与答案键逐格一致"),
             ("③ 跨院去重发病率/罕见病", "真机 · 两院 4038 + 3646 行 → 去重 6354 人"),
             ("④ 耐药菌监测与跨院信号", "本机端到端 · 联邦耐药率、折点敏感性、罕见表型抑制三项 PASS"),
             ("⑤ 药物警戒失衡信号", "线上 · 院内连接器沙箱 + 输出闸门 + 阅后即焚 · 单院"),
             ("⑥ 跨中心比较效果", "线上双中心 · 合并 OR 2.25（1.76–2.88）· I² 56% · 上链区块 1010"),
             ("⑦ 联邦学习预测", "线上 · 两院本地训练 + 控制面单轮聚合 · 聚合 AUC 0.600"),
             ("⑧ 合约期内分步查询", "本机集成测试 · 10/10 通过（含 5 类违规拦截、预算耗尽熔断）")]
    for i, (t, d) in enumerate(items):
        y = 1.58 + i * 0.575
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 4.95, y, 7.76, 0.53, fill=WHITE, radius=0.14, shadow=True)
        text(s, 5.15, y, 2.85, 0.53, [(t, 11.5, True, T_CARD)], anchor=MSO_ANCHOR.MIDDLE)
        text(s, 8.05, y, 4.55, 0.53, [(d, 11, False, T_MUTE)], anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    foot(s)

    # 07 实证一
    s = slide(prs); head(s, "实证一：疫苗不良反应主动监测（疾控 × 医院，真机全链路）",
                         "接种记录在疾控、就诊记录在医院；只比较同一个人两个时间窗内的事件数（自身对照设计）")
    for i, (v, u, l) in enumerate([("3 台", "", "云上 TDX 节点 + 独立网络域校验方"),
                                   ("2 方", "", "疾控与医院各自核验节点会话证明"),
                                   ("998–1000", " 区块", "三方回执链链头上链")]):
        kpi(s, GX + i * 4.06, 1.70, 3.86, 1.12, v, l, unit=u, vs=24)
    steps = [("1", "两院各自本地完成七项复核，封存最小字段投影（接种日期 / 就诊日期 + 假名键）"),
             ("2", "数据密钥各自托付给独立网络域的密钥保管方，平台不持有"),
             ("3", "保管方验签节点真实证明（证明链 TDX、TCB 5.1.3）后，向节点释放会话密钥"),
             ("4", "节点内执行算法模块：逐人算日期差并分层计数；发布审查 minCell=5、抑制 0 格"),
             ("5", "制品销毁 → 作业 PURGED → 回执上链；数据持有方各自核验见证并留痕")]
    for i, (n, t) in enumerate(steps):
        y = 3.05 + i * 0.62
        shape(s, MSO_SHAPE.OVAL, GX, y, 0.36, 0.36, fill=ACCENT)
        text(s, GX, y + 0.04, 0.36, 0.3, [(n, 12, True, DARK)], align=PP_ALIGN.CENTER)
        text(s, GX + 0.52, y - 0.02, 5.2, 0.48, [(t, 11, False, T_BODY)], spacing=1.15, anchor=MSO_ANCHOR.MIDDLE)
    shot(s, "screenshots/20-场景1-疫苗监测-复跑-合并结果-发布审查-回执上链.png", 6.42, 3.05, 6.29, 2.90,
         caption="作业详情页：分层计数 + 发布审查（minCell=5，抑制 0 格）+ 三方回执链与链头上链", badge="1")
    text(s, GX, 6.62, 6.2, 0.34, [("数据为合成数据，效应量为人为注入，不作为任何疫苗的真实风险结论。", 10, True, AMBER)])
    foot(s)

    # 08 实证一（续）
    s = slide(prs); head(s, "实证一（续）：真机环境与证明链长什么样",
                         "云上 TDX 机型、独立网络域校验方、节点内计算与销毁 —— 每一步都有原始日志可对")
    shot(s, "screenshots-redacted/30-真机-环境事实（已隐去实例ID与IP）.png", GX, 1.62, 4.30, 4.45,
         caption="真机环境事实：TDX 客户机检测、内存加密特性启用（实例 ID 与 IP 已隐去）", badge="1")
    shot(s, "screenshots/32-真机-teeA远程证明-探针结果.png", 5.25, 1.62, 7.46, 2.05,
         caption="可信计算节点远程证明探针：证明链型 TDX、代码度量值、最低可信基 5.1.3", badge="2")
    shot(s, "screenshots/34-真机-场景1-复跑-teeA节点内计算-发布审查-销毁.png", 5.25, 4.15, 7.46, 1.55,
         caption="节点内计算 → 发布审查（minCell=5，抑制 0 格）→ 制品销毁，作业最终 PURGED", badge="3")
    foot(s)

    # 09 实证二
    s = slide(prs); head(s, "实证二：TDX 客户机内的真实模块字节实测",
                         "在机密虚拟机内执行生产用的算法模块，与事先算好的答案键逐格对拍")
    for i, (v, u, l) in enumerate([("七层", "", "疫苗保护效果评估：与答案键逐格一致，一层按约定「不可估」"),
                                   ("6354", " 人", "跨院去重发病率：两院 4038 + 3646 行去重后病例数"),
                                   ("逐格一致", "", "与参考语义对拍，无人工调数")]):
        kpi(s, GX + i * 4.06, 1.70, 3.86, 1.12, v, l, unit=u, vs=24)
    shot(s, "screenshots/31-真机-场景2-3-TDX客户机内实测.png", 2.30, 3.00, 8.73, 3.40,
         caption="TDX 客户机内运行日志：场景②（保护效果评估）与场景③（跨院去重发病率）的逐格对拍结果", fs=10.5)
    foot(s)

    # 10 实证三
    s = slide(prs); head(s, "实证三：线上双中心比较效果（甲院 + 乙院）",
                         "跨中心合并原先被准入规则拦下 —— 没有绕过闸门，而是按正规流程补齐 k≥5 的预审组合与新合约")
    bars(s, GX - 0.10, 1.60, 4.40, 3.55, ["甲院", "乙院", "合并"], [2.56, 1.99, 2.25],
         [ACCENT, ACCENT, TEAL], num_fmt='0.00', title="各中心与合并 OR（95% CI 见正文）", maxs=3.2)
    text(s, GX, 5.28, 4.35, 1.5,
         [[("合并 OR 2.25（1.76–2.88）· I² 56% · 上链区块 1010", 11.5, True, DEEP)],
          [("两院各 5000 例；合规路径：新建声明 k=5 的预审组合 → 两院各自签发新合约 → 通过准入复审后执行。",
            10.5, False, T_MUTE)],
          [("边界：数据为合成数据，注入真值为 HR 2.5；不构成真实疗效证据。", 10.5, True, AMBER)]], spacing=1.25)
    shot(s, "screenshots/15-场景6-跨中心比较效果-任务详情.png", 5.05, 1.60, 7.66, 5.05,
         caption="任务详情：两院执行进度、连接器背书、随机效应合并与森林图", badge="1")
    foot(s)

    # 11 实证四
    s = slide(prs); head(s, "实证四：线上联邦学习 —— 模型出域、数据不出域",
                         "两院在各自连接器内训练，控制面只做单轮聚合；权重包经合约授权后在本地推理")
    bars(s, GX - 0.10, 1.60, 4.40, 3.10, ["甲院", "乙院", "聚合"], [0.611, 0.585, 0.600],
         [ACCENT, ACCENT, TEAL], num_fmt='0.000', title="各院本地与聚合 AUC", maxs=0.75)
    text(s, GX, 4.86, 4.35, 1.9,
         [[("训练在院内完成，出域的是模型增量而非特征行；聚合权重包经合约授权下载，在本地对患者特征打分。", 11, False, T_BODY)],
          [("", 5, False, T_BODY)],
          [("如实边界：单轮聚合、3 个粗特征、AUC 为训练集内指标（无留出集），事件率约 8% 时按 0.5 阈值 F1 为 0 —— 证明的是联邦训练链路在线上跑通，不是模型效果。",
            10.5, True, AMBER)]], spacing=1.25)
    shot(s, "screenshots/16-场景7-联邦学习预测-任务详情.png", 5.05, 1.60, 3.72, 2.55,
         caption="联邦任务详情：各方本地指标、聚合指标、模型哈希与存证", fs=9.5)
    shot(s, "screenshots/17-场景7-联邦学习预测-权重包本地推理.png", 8.99, 1.60, 3.72, 2.55,
         caption="聚合权重包在浏览器本地对患者特征打分（特征不上送）", fs=9.5)
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 5.05, 4.55, 7.66, 2.05, fill=TEAL, radius=0.05, shadow=True)
    text(s, 5.35, 4.75, 7.06, 1.7,
         [[("这条链路上，双方各自持有的是模型增量，不是对方的原始特征行。", 13.5, True, WHITE)],
          [("可核验点：模型哈希与权重包存证在链；任务记录里能看到各方本地指标与聚合指标 —— 但并不包含任何一方患者的特征明细。",
            11, False, MINT)]], spacing=1.35)
    foot(s)

    # 12 实证五
    s = slide(prs); head(s, "实证五：院内沙箱计算与「闸门按设计拦人」",
                         "能就地算的就在院内算；越线的请求会被合规闸门拒绝执行")
    shot(s, "screenshots/12-场景5-药物警戒失衡信号-任务详情.png", GX, 1.66, 5.96, 3.20,
         caption="场景⑤：任务在院内连接器沙箱内执行（isolation=wasm-sandbox），输出闸门后交付、阅后即焚", badge="1")
    shot(s, "screenshots/14-场景6-跨中心任务-准入复审闸门拦截.png", 6.75, 1.66, 5.96, 3.20,
         caption="跨中心任务未声明 k 匿名参数时被准入复审拒绝执行（后按正规流程补齐并跑通）", badge="2")
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 5.28, GW, 1.28, fill=TEAL, radius=0.05, shadow=True)
    shape(s, MSO_SHAPE.OVAL, GX + 0.30, 5.90, 0.24, 0.24, fill=AMBER)
    text(s, GX + 0.72, 5.50, 11.0, 0.95,
         [("为什么把「被拒绝」也放进材料：", 13, True, WHITE),
          ("可信空间的证明力来自「不该发生的确实没发生」。闸门拒绝、输出抑制、撤销即停、退出即抹除 —— 这些负向行为同样有据可查。",
           12, False, MINT)], spacing=1.3)
    foot(s)

    # 13 工程可信度
    s = slide(prs); head(s, "工程可信度：发现问题 → 修复 → 复验，全过程留痕",
                         "上一版材料里如实记下的问题，当晚修复上线并跑复验作业；没有一项被抹掉")
    for i, (v, u, l) in enumerate([("2 分 46 秒", "", "直连入口下全链路作业耗时（提交 → 销毁），各阶段一次成功"),
                                   ("1039–1041", " 区块", "修复后全链路复验作业的回执链上链"),
                                   ("1049–1051", " 区块", "切换直连入口后原配置复跑的上链记录")]):
        kpi(s, GX + i * 4.06, 1.70, 3.86, 1.12, v, l, unit=u, vs=20)
    fixes = [("阶段幂等", "同一阶段不再重复封存；被顶替的信封撤回；大载荷不逐轮重发"),
             ("出站超时", "各出站请求加超时；响应体按进展判定，避免跨境链路掐断大批次"),
             ("重复哈希", "重跑确定性任务时返回既有链上记录并标注「复用」，不再降级为本地回执"),
             ("联邦收敛", "本地训练改阻尼牛顿法并校正分箱；预置超参重跑，聚合 AUC 0.600、无告警")]
    for i, (t, b) in enumerate(fixes):
        card(s, GX + (i % 2) * 6.13, 3.05 + (i // 2) * 1.62, t, b, ch=None, w=5.96, h=1.46)
    text(s, GX, 6.34, GW, 0.5,
         [("复验证据：", 11, True, TEAL),
          ("全链路复验 job-muy1ioki…（区块 1039–1041）与直连入口复跑 job-muy4x0ka…（区块 1049–1051）均有完整日志与上链记录；重复哈希修复见存证记录（区块 22 复用）。",
           11, False, T_BODY)])
    foot(s)

    # 14 如实边界
    s = slide(prs); head(s, "如实边界：哪些已经跑通，哪些还没有", "把没做的说清楚，是合作能继续下去的前提")
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 1.72, 5.96, 4.60, fill=WHITE, radius=0.05, shadow=True)
    text(s, GX + 0.30, 1.94, 5.3, 0.4, [("已跑通（有可复核证据）", 15, True, TEAL)])
    for i, t in enumerate(["真机全链路：疫苗不良反应主动监测（两次 + 修复后复验）",
                           "真机客户机内实测：疫苗保护效果评估、跨院去重发病率",
                           "线上双中心合并、线上联邦训练与权重本地推理",
                           "院内沙箱计算、输出闸门、销毁与回执、撤销即停",
                           "存量缺陷的修复与复验闭环（幂等、超时、重复哈希、联邦收敛）"]):
        text(s, GX + 0.30, 2.52 + i * 0.72, 5.3, 0.66, [("· " + t, 11.5, False, T_BODY)], spacing=1.2)
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 6.75, 1.72, 5.96, 4.60, fill=DARK, radius=0.05)
    text(s, 7.05, 1.94, 5.3, 0.4, [("还没做 / 不能声称", 15, True, AMBER)])
    for i, t in enumerate(["耐药监测、合约期内分步查询仅有本机证据，未在真机或线上验证",
                           "因果生存（L3）暂无线上证据",
                           "全部数据为合成数据、信号为人为注入 —— 不构成任何真实人群结论",
                           "截图中的机构与数据产品名为演示占位（甲院 / 乙院 / siteA / siteB），非真实部署机构",
                           "院内执行环境是软件级隔离；硬件机密计算只在云上可信计算节点",
                           "密钥保管目前是试验性配置；生产级密钥管理与链侧按哈希查询待在真实环境验证",
                           "节点查询预算账本尚未持久化；跨机构多院信号尚未取得"]):
        text(s, 7.05, 2.52 + i * 0.62, 5.3, 0.58, [("· " + t, 11, False, MINT)], spacing=1.2)
    foot(s)

    # 15 合作基础（一）
    s = slide(prs); head(s, "合作基础（一）：我们可以提供什么",
                         "不是一份方案书，而是一套已经跑在真机与线上环境里的东西")
    prov = [("台", "可信数据空间平台", "控制面 + 院内连接器 + 中立可信计算节点；院内只需一台只出站的机器"),
            ("库", "算法与场景模块库", "药物警戒、疫苗安全与效果、跨院去重、耐药监测等场景模板与模块"),
            ("证", "机密计算验证能力", "云上 TDX 全链路实测经验：证明 → 放钥 → 节点内计算 → 审查 → 销毁"),
            ("规", "治理与合规工程化", "分类分级、最小字段、小单元格、撤销即停写成可机检的约束，而非制度文本"),
            ("台", "运营控制台", "目录、合约、连接器、作业编排、输出审查、存证账本、审计追溯、结算台账"),
            ("证", "可复现证据包", "每次作业产出模块摘要、计划哈希、硬件证明、执行与销毁回执、上链记录")]
    for i, (ch, t, b) in enumerate(prov):
        card(s, GX + (i % 3) * 4.06, 1.72 + (i // 3) * 1.72, t, b, ch=ch, teal=(i % 2 == 1))
    band(s, 5.30, ["连接器可独立部署", "数据密钥机构自持", "合约撤销即时生效", "退出即抹除"], "合作的工程前提")
    foot(s)

    # 16 合作基础（二）
    s = slide(prs); head(s, "合作基础（二）：三种合作形态与分工建议",
                         "先选一个「必须逐人连接」的真实场景跑通，再谈规模化")
    forms = [("形态 A", "联合研发", "围绕具体病种/药械的真实世界研究与监测方法，共同设计分析规格并联合产出成果", False),
             ("形态 B", "数据协作网络共建", "合作方提供机构网络与数据资源，我们提供连接器、节点与规则引擎，共建多中心协作网络", True),
             ("形态 C", "共同运营", "在区域或行业层面共建运营：合作方主导规则与准入，我们提供平台、节点运维与技术支撑", False)]
    for i, (k, t, b, hl) in enumerate(forms):
        x = GX + i * 4.06
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, 1.72, 3.86, 2.10, fill=TEAL if hl else WHITE, radius=0.05, shadow=True)
        text(s, x + 0.26, 1.90, 3.3, 0.3, [(k, 11, True, ACCENT if hl else TEAL)])
        text(s, x + 0.26, 2.22, 3.3, 0.4, [(t, 15, True, WHITE if hl else T_CARD)])
        text(s, x + 0.26, 2.74, 3.34, 0.94, [(b, 11, False, MINT if hl else T_BODY)], spacing=1.22)
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 4.02, GW, 2.55, fill=WHITE, radius=0.05, shadow=True)
    text(s, GX + 0.30, 4.22, 5.4, 0.36, [("我们需要的合作要素", 13.5, True, T_CARD)])
    for i, t in enumerate(["真实的场景与业务需求（临床 / 公卫 / 药械研发）",
                           "机构网络与数据资源可用性判断（含伦理与合规路径）",
                           "区域或行业层面的组织与协调能力",
                           "对结果复核与联合产出的预期（报告 / 论文 / 标准）"]):
        text(s, GX + 0.30, 4.66 + i * 0.44, 5.4, 0.42, [("· " + t, 11, False, T_BODY)])
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 6.70, 4.24, 0.02, 2.10, fill=LINE)
    text(s, 6.98, 4.22, 5.5, 0.36, [("常见顾虑的直接回应", 13.5, True, T_CARD)])
    for i, t in enumerate(["数据会不会被平台拿走？—— 院内连接器只主动出站，原始行级数据不进入控制面。",
                           "密钥谁掌握？—— 数据密钥由机构各自托付给独立保管方，平台不持有。",
                           "说停能不能停？—— 合约撤销即时生效；作业结束即销毁并回执。",
                           "凭什么信？—— 每次作业产出可复核证据包，机构可各自核验证明。"]):
        text(s, 6.98, 4.62 + i * 0.46, 5.5, 0.44, [("· " + t, 11, False, T_MUTE)], spacing=1.05)
    foot(s)

    # 17 下一步
    s = slide(prs); head(s, "下一步：30 / 60 / 90 天", "把「能合作」变成「已经在一起干活」")
    phases = [("30 天", "选场景 · 定边界", ["共同选定 1 个必须逐人连接的场景", "确认数据可用性与伦理/合规路径", "输出连接器部署与网络要求清单"], False),
              ("60 天", "连一家 · 跑一遍", ["完成 1 家机构连接器联调（院内只出站）", "在合成或脱敏数据上端到端跑通", "共同复核结果与证据包"], True),
              ("90 天", "扩多中心 · 出成果", ["扩展到 2–3 家机构的多中心协作", "形成可复核的联合成果（报告/论文/标准）", "明确下一阶段的共建或共同运营形态"], False)]
    for i, (k, t, items, hl) in enumerate(phases):
        x = GX + i * 4.06
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, 1.76, 3.86, 3.55, fill=TEAL if hl else WHITE, radius=0.05, shadow=True)
        text(s, x + 0.30, 1.98, 3.3, 0.4, [(k, 16, True, ACCENT if hl else TEAL)])
        text(s, x + 0.30, 2.44, 3.3, 0.4, [(t, 14, True, WHITE if hl else T_CARD)])
        for j, it in enumerate(items):
            text(s, x + 0.30, 3.00 + j * 0.72, 3.3, 0.66, [("· " + it, 11, False, MINT if hl else T_BODY)], spacing=1.2)
    shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, GX, 5.48, GW, 1.05, fill=DARK, radius=0.05)
    text(s, GX + 0.32, 5.66, 11.4, 0.72,
         [("先做一件小事：", 13.5, True, ACCENT),
          ("选一个「数据在两处、必须逐人连接」的真实问题，我们用现有连接器与节点把它跑一遍 —— 结果、证据与边界一并交给你方复核。",
           12, False, MINT)], spacing=1.3)
    text(s, GX, 6.66, GW, 0.3, [("联系方式：【待填】", 10.5, False, T_MUTE)])
    foot(s)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    return OUT


if __name__ == "__main__":
    p = main()
    n = len(Presentation(p).slides)
    print(f"✓ {p.relative_to(ROOT)}（{n} 页，{p.stat().st_size/1048576:.1f} MB）")
