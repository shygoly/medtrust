#!/usr/bin/env python3
"""Generate 国家数据局可信空间申报指南.docx from MedTrust capabilities."""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT = Path("/Users/mac/Sync/project/medtrust/docs/国家数据局可信空间申报指南.docx")

NAVY = RGBColor(0x1B, 0x3A, 0x5F)
RED = RGBColor(0x8B, 0x1A, 0x1A)
GRAY = RGBColor(0x55, 0x55, 0x55)
FILL_YELLOW = "FFF3CD"
FILL_HEADER = "1B3A5F"
FILL_ALT = "F4F7FA"


def set_run_font(run, name_cn="宋体", name_en="Times New Roman", size=12, bold=False, color=None):
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = name_en
    if color:
        run.font.color.rgb = color
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:eastAsia"), name_cn)
    rFonts.set(qn("w:ascii"), name_en)
    rFonts.set(qn("w:hAnsi"), name_en)


def add_para(doc, text, *, size=12, bold=False, cn="宋体", align="left", space_after=8, space_before=0, color=None, first_line=True):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(space_before)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    if first_line and align == "left" and not bold:
        pf.first_line_indent = Cm(0.74)
    if align == "center":
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "right":
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    elif align == "justify":
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    run = p.add_run(text)
    set_run_font(run, name_cn=cn, size=size, bold=bold, color=color)
    return p


def heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16 if level == 1 else 12)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.first_line_indent = Cm(0)
    size = {1: 16, 2: 14, 3: 12}[level]
    run = p.add_run(text)
    set_run_font(run, name_cn="黑体", size=size, bold=True, color=NAVY)
    return p


def note(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.first_line_indent = Cm(0)
    run = p.add_run(text)
    set_run_font(run, name_cn="楷体", size=10.5, color=RED)
    return p


def shade_cell(cell, hex_color):
    from docx.oxml import OxmlElement

    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = tcPr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tcPr.append(shd)
    shd.set(qn("w:fill"), hex_color)
    shd.set(qn("w:val"), "clear")


def set_cell_text(cell, text, *, bold=False, size=10.5, color=None, cn="宋体", center=False):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.first_line_indent = Cm(0)
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    set_run_font(run, name_cn=cn, size=size, bold=bold, color=color)


def add_table(doc, headers, rows, col_widths=None, highlight_pending=True):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        set_cell_text(cell, h, bold=True, size=10.5, color=RGBColor(255, 255, 255), cn="黑体", center=True)
        shade_cell(cell, FILL_HEADER)
    for r_i, row in enumerate(rows):
        for c_i, val in enumerate(row):
            cell = table.rows[r_i + 1].cells[c_i]
            pending = highlight_pending and "待填" in str(val)
            set_cell_text(
                cell,
                str(val),
                size=10.5,
                color=RED if pending else None,
                cn="楷体" if pending else "宋体",
            )
            if pending:
                shade_cell(cell, FILL_YELLOW)
            elif r_i % 2 == 1:
                shade_cell(cell, FILL_ALT)
    if col_widths:
        for row in table.rows:
            for i, w in enumerate(col_widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph()
    return table


def setup_doc():
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(2.54)
    sec.right_margin = Cm(2.54)
    sec.top_margin = Cm(2.54)
    sec.bottom_margin = Cm(2.54)
    sec.header_distance = Cm(1.5)
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = hp.add_run("国家数据局 · 2025 年可信数据空间创新发展试点 · 行业方向填报稿（医疗健康）")
    set_run_font(r, name_cn="楷体", size=9, color=GRAY)
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("内部填报稿 · 不得作为已获批试点资格的对外表述  ·  第 ")
    set_run_font(r, size=9, color=GRAY)
    # PAGE field
    from docx.oxml import OxmlElement

    def add_fld(paragraph, instr):
        run = paragraph.add_run()
        set_run_font(run, size=9, color=GRAY)
        fldChar1 = OxmlElement("w:fldChar")
        fldChar1.set(qn("w:fldCharType"), "begin")
        instrText = OxmlElement("w:instrText")
        instrText.set(qn("xml:space"), "preserve")
        instrText.text = instr
        fldChar2 = OxmlElement("w:fldChar")
        fldChar2.set(qn("w:fldCharType"), "end")
        run._r.append(fldChar1)
        run._r.append(instrText)
        run._r.append(fldChar2)

    add_fld(fp, " PAGE ")
    r = fp.add_run(" 页")
    set_run_font(r, size=9, color=GRAY)
    return doc


def cover(doc):
    add_para(doc, "附件 3", size=12, bold=True, cn="黑体", align="center", first_line=False, space_after=6)
    add_para(doc, "2025 年行业可信数据空间创新发展试点项目", size=18, bold=True, cn="黑体", align="center", first_line=False, space_after=4, color=NAVY)
    add_para(doc, "申报书", size=22, bold=True, cn="黑体", align="center", first_line=False, space_after=6, color=NAVY)
    add_para(doc, "（按系统现有能力填报 · 医疗健康方向）", size=14, bold=True, cn="楷体", align="center", first_line=False, space_after=18, color=RED)

    meta = [
        ("试点名称", "医疗健康可信数据空间（MedTrust）真实世界研究与医防协同创新试点"),
        ("申报单位", "【待填：境内独立企业法人或国家级创新平台全称】（加盖单位公章）"),
        ("推荐单位", "【待填：省级数据管理部门或中央企业全称】（加盖单位公章）"),
        ("国家行业主管部门", "【选填：国家卫生健康委 / 国家疾控局 / 国家药监局，宜联合推荐】"),
        ("申报日期", "【待填】年  【待填】月  【待填】日"),
        ("对应通知", "国家数据局综合司 2025 年 4 月 3 日《关于组织开展 2025 年可信数据空间创新发展试点工作的通知》"),
        ("源文件编号", "P020250411524209271991"),
        ("填报依据", "以 MedTrust 仓库现行代码、元语契约与可复跑证据为准；合成数据不得外推为真实流行病学结论"),
    ]
    t = doc.add_table(rows=len(meta), cols=2)
    t.style = "Table Grid"
    for i, (k, v) in enumerate(meta):
        shade_cell(t.rows[i].cells[0], FILL_HEADER)
        set_cell_text(t.rows[i].cells[0], k, bold=True, cn="黑体", size=11, color=RGBColor(255, 255, 255), center=True)
        pending = "待填" in v or "选填" in v
        set_cell_text(t.rows[i].cells[1], v, size=11, color=RED if pending else None, cn="楷体" if pending else "宋体")
        if pending:
            shade_cell(t.rows[i].cells[1], FILL_YELLOW)
        t.rows[i].cells[0].width = Cm(4.2)
        t.rows[i].cells[1].width = Cm(11.8)

    add_para(doc, "国家数据局编制　｜　本填报稿由项目技术团队依据系统能力整理，法律主体、财务与推荐意见须运营单位核定后盖章。", size=10.5, cn="楷体", align="center", first_line=False, space_before=18, color=GRAY)


def section0(doc):
    heading(doc, "〇、填报说明（本文件如何使用）", 1)
    add_para(
        doc,
        "本文同时承担两件事：一是把国家数据局 2025 年试点通知（企业/行业/城市三类、附件 1–4）改写成可直接盖章报送的行业申报书骨架；二是用 MedTrust（医疗可信数据空间）当前真实能力逐栏填写，并显式标出「已具备 / 试点期内须补齐 / 不得对外虚报」。黄色底纹字段为人、财、章、推荐单位事项，技术侧不得代填。",
        align="justify",
    )
    add_para(
        doc,
        "通知原文截止日期为 2025 年 4 月 24 日。若本轮已过，本稿仍可作为下一年度同类申报、省级推荐材料或行业主管部门联合推荐的底稿，栏目结构与附件 2「行业」要素条件一一对应，不必重写。",
        align="justify",
    )
    heading(doc, "填报红线（与系统对外口径一致）", 2)
    bullets = [
        "试点类型只勾「医疗健康行业可信数据空间」。本系统不是供应链龙头企业空间，也不具备覆盖一市 60% 公共数据、上架 2000 个产品的城市空间条件。",
        "技术上可以说：明文不出院、最小必要投影、密文进可信执行环境、只出过闸聚合、合约与回执上链、硬件证明通过后才释放密钥（Intel TDX 试点已实测场景一全链路）。",
        "技术上不可以说：「数据完全不出医院」（密文物理出域）、「绝对安全」「平台担保密钥」「已形成真实疫苗风险/保护效果/地区发病率结论」。演示数据为 Synthea 合成人群加注入信号。",
        "附件 2 行业量化指标（10 类场景、30 个产品、每应用服务 100 家企业、接入主体份额 30%、第三方服务机构 30 家、收入不低于总投资 20%）多数属于两年试点目标，不是当前已达成事实。响应表必须写成「现状值 + 试点期末目标」，禁止把目标写成已完成。",
        "申报主体须为单一运营单位，不支持多运营主体联合申报。医院、疾控、药企、云厂商、芯片厂商均是参与方而非联合申报人。",
    ]
    for b in bullets:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.74)
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run("· " + b)
        set_run_font(run, size=12)


def section_notice(doc):
    heading(doc, "申报须知（摘自通知，填报时须遵守）", 1)
    add_para(doc, "一、申报材料要求盖章处须加盖公章，复印无效，申报书须加盖骑缝章。现有工作基础、相关保障条件承诺必须如实填报。", align="justify")
    add_para(doc, "二、「推荐单位」为省级数据管理部门或中央企业，名称用全称。行业可信数据空间宜由国家行业主管部门联合推荐。", align="justify")
    add_para(doc, "三、纸质材料一式三份，电子版以光盘随纸质材料报送。页面不够可另加页。推荐文件电子版命名：「推荐意向序号-试点名称-试点类型-申报单位」。", align="justify")


def section1(doc):
    heading(doc, "一、项目基本信息", 1)
    add_table(
        doc,
        ["栏目", "填报内容", "说明"],
        [
            ["试点名称", "医疗健康可信数据空间（MedTrust）真实世界研究与医防协同创新试点", "突出行业+场景，避免只写产品名"],
            ["申报单位名称", "【待填】", "境内独立法人；近三年信用良好"],
            ["试点周期", "【待填】年【待填】月至【待填】年【待填】月", "通知要求两年试点培育"],
            ["拟投入资金总额（万元）", "【待填】", "须与第八部分投资明细一致"],
            ["已投入资金（万元）", "【待填：研发+TDX 试点+连接器部署，据实】", "可计入已发生的工程与云资源"],
            ["联系人 / 职务 / 手机 / 邮箱 / 传真", "【待填】", ""],
            ["单位地址 / 法定代表人 / 统一社会信用代码", "【待填】", ""],
            ["单位性质", "【待填勾选】国有企业 / 民营 / 外资 / 合资 / 国家级创新平台 / 其他", ""],
            ["近三年资产、负债、收入、利润", "【待填，附审计报告】", "证明材料第十部分"],
            ["近三年重大信息安全/网络安全/生产安全事故", "☐否（建议据实勾选）　☐是（须列事件名称）", "承诺书须一致"],
            ["试点方向", "☑ 医疗健康　行业可信数据空间", "对应附件 1 第 8 条"],
        ],
        col_widths=[4.5, 8.0, 3.5],
    )


def section2(doc):
    heading(doc, "二、发展基础", 1)
    heading(doc, "（一）试点申报单位基本情况（不超过 1000 字）", 2)
    note(doc, "【主体概况段请运营单位自行替换为营业执照口径。以下为技术侧可并入的「空间相关工作基础」表述，约 900 字。】")
    add_para(
        doc,
        "MedTrust 是面向医疗健康行业的联邦可信数据空间：中心控制面只掌握身份、目录、数字合约、编排与结算元数据；医院/疾控侧部署连接器，原始诊疗与接种登记永久留在本地。跨域物理传输仅允许加密最小投影（C2）与过闸聚合结果（C3），协议编译期禁止原始行级数据（C0）出现在任何跨节点边上。该形态对齐《可信数据空间发展行动计划（2024—2028 年）》及国家数据局相关技术架构中「数字合约 + 使用控制」核心要求，并按 SAC/TC609 可信数据空间技术能力评价框架建设身份、连接器、目录、合约、使用控制、存证审计等模块。",
        align="justify",
    )
    add_para(
        doc,
        "已形成可运行的双平面系统：控制面（NestJS API + Next.js 控制台）提供参与方 SM2 身份与证书、数据产品目录、数字合约签署与撤销、MDOP 跨节点作业编排、长安链存证、按贡献分账；连接器平面提供本地数据不出域守卫、策略执行点（PEP）、Wasm 零能力沙箱、小单元格抑制与差分隐私预算接口、可信空间节点（Intel TDX）会话执行。国密 SM2/SM3/SM4 贯穿通道与摘要；密钥由独立保管路径释放，平台、云厂商、技术供应商不单独持有业务数据密钥。",
        align="justify",
    )
    add_para(
        doc,
        "应用上已跑通药企×医院真实世界研究阶梯（失衡信号、效应量合并、生存因果、联邦学习）以及必须「逐人跨机构连接」才能计算的公共卫生场景：疫苗接种后不良事件自身对照风险期（疾控接种日×医院就诊日，已在 Intel TDX 完成证明—密钥释放—节点内计算—发布审查—销毁上链全链路）、疫苗真实世界保护效果检测阴性设计、跨院去重发病率与罕见病登记、细菌耐药哨点。算子以可复现 Wasm 模块入库，模块摘要国密 SM3 对拍，发布审查对小单元格与罕见病列双阈值抑制。治理上以 DOMAIN/FLOWS/TRUST/EVIDENCE 等机器校验元语约束「原始数据不得出域」与研究效度，违反即测试失败。",
        align="justify",
    )
    add_para(
        doc,
        "能力边界须同时写清：当前演示与 TDX 实测以合成数据及注入信号为主，真实医疗机构数据接入仍须完成伦理与合规闸门；结算目前以队列规模为贡献代理；跨空间互联为最小实现（信任清单 + 证书吊销）；城市级公共数据汇聚、大规模数据交易市场、真实支付清结算不在已交付范围内。申报单位若为技术服务商，应在本段补充行业数据整合授权、医院/疾控合作意向与主管部门沟通进展，以满足「具备该行业领域数据资源整合能力」的主体资格。",
        align="justify",
    )

    heading(doc, "（二）可信数据空间其他参与主体情况", 2)
    add_table(
        doc,
        ["相关方（角色）", "职责分工", "合作内容（据实 / 演示已具备）"],
        [
            ["【待填】空间运营方（申报主体）", "规则制定、目录与合约运营、节点运维、争议受理、收益清算", "不得与多主体联合作为「共同运营方」申报"],
            ["数据提供方：医院连接器（演示：华山/瑞金等）", "本地存数、封装最小投影、PEP 强制合约、上报 C3 与销毁回执", "药敏、就诊事件、观察期、检测结果等数据产品；明文不出院"],
            ["数据提供方：疾控连接器（演示：区疾控中心）", "接种登记投影封装、核验节点证明后授权密钥释放", "AEFI/VE 场景的免疫史一侧；与医院日期对齐只发生在节点内"],
            ["数据使用方：药企 / 研究申办方 / 疾控业务处室", "提交数字合约约定的分析任务，只接收过闸聚合与事实清单", "RWS 阶梯、疫苗安全与效果、发病率去重"],
            ["技术服务方：连接器与控制面研发", "MDOP 协议、Wasm 算子库、控制台、国密与治理守护", "开源仓内可复核；不持有医院密钥"],
            ["可信空间节点运营（与密钥释放权分离）", "TDX 客户机执行封存计算、发布审查、语料销毁", "Intel TDX 试点；证明由校验方核验，平台只搬运证明不自评"],
            ["密钥保管 / 校验方", "硬件证明通过后释放会话密钥", "决策要求运营方与密钥释放权分离"],
            ["存证链：长安链 ChainMaker", "合约哈希、作业回执、销毁回执上链", "只存证据不存业务数据"],
            ["监管 / 合规审查方（控制台角色）", "分级分类、合约策略、小单元格与用途符合性审查", "合规预审闸门；真实数据前须伦理批件"],
            ["芯片与云基础设施（Intel TDX 等）", "机密虚拟机与远程证明", "提供执行环境，不参与明文"],
            ["第三方服务（规划）", "审计清算、数据经纪、合规咨询", "现状：模块已预留结算/审计；机构数量未达附件 2 的 30 家，属试点培育目标"],
        ],
        col_widths=[5.0, 5.5, 5.5],
    )

    heading(doc, "（三）已开展工作（不超过 1000 字）", 2)
    heading(doc, "1. 应用场景与数据产品", 3)
    add_para(
        doc,
        "已形成「场景驱动、一场景一协议模板、一签名算子、一组最小投影」的共创模式。真实世界研究：药物警戒不成比例分析（PRR/ROR）、跨中心效应量合并、倾向评分匹配后生存分析、联邦学习预测。公共卫生与医防融合：疫苗 AEFI 主动监测（SCRI）、疫苗保护效果（TND）、跨院发病率/罕见病去重、AMR 耐药率与折点重判读及用药—耐药信号。目录侧以数据产品登记（分级分类、权利确认、记录规模、FHIR/投影字段）上架，合约绑定允许算子、接收方、输出策略（仅聚合）与小单元格阈值。高质量数据集目前以治理后的合成基座（约 7000 人 Synthea 人群）加场景注入层为主，用于可复现验收，不得当作区域真实病谱。",
        align="justify",
    )
    heading(doc, "2. 技术系统：可信管控、资源交互、价值共创", 3)
    add_para(
        doc,
        "可信管控：SM2 参与方身份与连接器证书；数字合约签署、备案、立即撤销（fail-closed）；连接器 PEP 按本院合约副本执行；用途与输出范围写入合约而非一次性审批。资源交互：数据产品目录查询与申请；MDOP 将跨院作业编译为片段要约，各持有方本地复核后签名接受，平台收齐后签发执行凭证；C2 信封由平台中继但不解密。价值共创：按任务的聚合结果交付；结算台账按各院队列规模代理贡献分账并上链；Wasm 算子注册中心 + 吊销名单，第三方模块须准入。安全管理：国密算法、Vault 密钥缓存策略、输出闸门（默认 n<5 抑制）、节点内发布审查、作业结束销毁与回执、控制点与敏感字段分级由 TRUST 契约机器对拍。",
        align="justify",
    )
    heading(doc, "3. 运营管理", 3)
    add_para(
        doc,
        "已具备运营控制台角色（提供方/使用方/运营方/合规），空间、连接器、目录、合约、作业、存证、结算、审计页面可演示。规则以数字合约条款 + 协议错误码 + 元语红线固化，而非仅靠管理制度 PDF。尚未形成面向附件 2 的完整商业化运营团队编制、争议仲裁机构名录、以及「收入不低于总投资 20%」的财务闭环——须在试点方案第四部分给出组建计划，不能把控制台角色误报为已有独立法人运营体系。",
        align="justify",
    )


def section3(doc):
    heading(doc, "三、试点目标（不超过 1000 字）", 1)
    heading(doc, "（一）拟解决的关键问题", 2)
    add_para(
        doc,
        "医疗健康数据「不敢流通、不能逐人协同、加总即重复」。医院与疾控分持暴露与结局，明文汇聚触碰个保法与伦理红线；各算各的又算不出接种后风险期、免疫建立期、跨院人时并集。传统中心化平台与「只出统计表」的联邦汇总，覆盖不了必须纵向连接的公卫与 RWE 问题。同时，行业缺少与合约绑定的使用控制、与硬件证明绑定的密钥释放、以及可复核的算子与小单元格审查，导致主管部门难以验收「真的没把名单传出去」。",
        align="justify",
    )
    heading(doc, "（二）预期效果", 2)
    add_para(
        doc,
        "两年内建成可复制的医疗行业空间：连接器进医院/疾控机房、控制面与中立 TDX 节点分设、密钥释放与运营分离。形成疫苗安全、疫苗效果、跨院发病、耐药监测、药物警戒、因果评估等可考核场景包；目录与合约支撑数据产品上架和按次/按任务计费；销毁与存证满足监管追溯。对医院的价值是「明文不出院仍能参与多中心研究并获分账」；对疾控是「接种登记不必交出行级仍能做主动监测」；对药企/器械是「拿得到过闸证据链上的 RWE」；对数据局是「医疗健康方向可示范的国家数据基础设施运营经验」。",
        align="justify",
    )
    heading(doc, "（三）分年度可考核指标（建议，须与投资匹配后锁定）", 2)
    add_table(
        doc,
        ["年度", "指标", "建议目标值", "现状（填报日）"],
        [
            ["试点第 1 年", "细分高质量数据集/库", "≥5 个（免疫、就诊事件、药敏、队列观察、检测）", "合成演示库已有；真实库【待填接入数】"],
            ["试点第 1 年", "典型应用场景类别", "≥6 类可演示（见方案一）", "已具备 4 类公共卫生 + RWS 阶梯"],
            ["试点第 1 年", "真实机构连接器", "≥【待填】家医院 + 1 家疾控试点", "演示拓扑 2 院 + 1 疾控；生产【待填】"],
            ["试点第 1 年", "TDX/等效节点作业", "疫苗 SCRI 类作业可复核复跑", "场景一已在 TDX 真跑"],
            ["试点第 2 年", "场景类别 / 产品与服务", "≥10 类、≥30 项（含服务封装）", "未达附件 2 期末值"],
            ["试点第 2 年", "高价值应用服务对象", "5 个应用各服务 ≥100 家（含中小医疗机构/研究团队，口径须主管部门认可）", "未达；需生态拓展"],
            ["试点第 2 年", "第三方服务机构", "≥30 家（合规、审计、实施、云、芯片、CRO 等）", "未达"],
            ["试点第 2 年", "空间收入 / 总投资", "≥20%（附件 2 行业要求）", "真实支付未接入，【待填财务】"],
            ["全程", "数据资源开放总量", "试点期内翻一番（以目录上架产品/可调用服务次数计）", "基期【待填】"],
        ],
        col_widths=[3.0, 3.8, 5.2, 4.0],
    )
    heading(doc, "（四）试点目标响应表（行业要素条件）", 2)
    add_table(
        doc,
        ["响应事项", "响应指标以及指标（目标）值", "响应情况（能力事实 / 缺口）"],
        [
            [
                "具有更开放的数据资源",
                "≥5 个细分领域高质量数据集或数据库；试点期内开放总量翻一番",
                "已有：免疫登记投影、就诊/不良事件、检测、跨院观察期与罕见病标志、药敏 AST、RWS 计数产品（演示/合成）。真实多中心库与「翻一番」基期数【待填】。开放形态为「可合约调用的最小投影与 C3 服务」，不是明文下载。",
            ],
            [
                "具有更丰富的数据产品和服务",
                "≥10 类典型场景、30 个产品和服务；其中 ≥5 个高价值应用，每个服务 ≥100 家企业",
                "已有场景包：AEFI-SCRI、VE-TND、跨院去重发病率、AMR、L1.5 药物警戒、L2 Meta、L3 因果、L4 联邦学习、配对队列、服务计算管道。产品形态=目录产品+合约服务+Wasm 算子。10 类/30 项/100 家为期末目标，现状不得填「已完成」。",
            ],
            [
                "具有更活跃的产业生态",
                "接入主体份额合计 ≥ 本行业 30%；日活 ≥30%；第三方服务机构 ≥30 家",
                "技术上已区分提供方/使用方/运营方/服务方/校验方。市场份额与日活属运营统计，系统有作业与用户角色但无行业 30% 份额事实，必须写培育计划，禁止用演示账号数充抵。",
            ],
            [
                "具有可行的技术支撑系统",
                "可信管控、资源交互、应用开发、安全管理",
                "已具备：身份与合约、目录、MDOP 编排、Wasm 开发与准入、TDX 节点、输出闸门、国密、长安链审计。应用开发中心（低代码/托管式 IDE）为弱项，试点需补工具链与第三方算子市场。",
            ],
            [
                "具有更完备的运营管理体系",
                "可持续商业模式；准入、流通、争议仲裁、收益分配；收入 ≥ 总投资 20%",
                "已具备：合约准入与撤销、使用控制、cohortSize 分账台账、审计追溯。争议仲裁制度、动态估值模型、真实支付、20% 回报为运营缺口，见第四节方案。",
            ],
        ],
        col_widths=[3.2, 5.0, 7.8],
    )


def section4(doc):
    heading(doc, "四、总体思路（不超过 1000 字）", 1)
    add_para(
        doc,
        "总体思路：以「必须逐人跨机构才能算」的医疗与公卫问题为牵引，用连接器把数据留在持有方，用中立可信空间节点做唯一允许的明文会合点，用数字合约把用途、字段、算子、阈值和分账一次锁死，用硬件证明与销毁回执让监管可验收。",
        align="justify",
    )
    add_para(
        doc,
        "主要任务六条，对应通知「重点工作任务」：（1）应用共创——把已验证的 SCRI/TND/去重/AMR/RWS 阶梯产品化，并向传染病漏报、院感跨院随访、孕产结局、死因补全等同构场景复制；（2）资源流通——目录 + 标识（参与方/产品/作业 URN）+ 最小投影白名单，推动高质量数据集按合约开放而非按库拷贝；（3）产业生态——医院实施商、CRO、合规审计、云与芯片、疾控信息化厂商以服务方接入，探索先用后付与按任务分账；（4）运营——单一运营主体、准入认证、异议与侵权追责流程，收益按贡献台账清算；（5）技术路径——沿用已落地的轻量方案（连接器 + TDX 节点 + 零能力 Wasm），持续迭代算子而不重写 MPC 电路；（6）互联互通——在身份互认、目录互发现、合约策略互认上与区域公共数据空间对接，数据仍不出源。",
        align="justify",
    )


def section5(doc):
    heading(doc, "五、试点方案", 1)
    heading(doc, "（一）应用共创情况", 2)
    add_para(
        doc,
        "共创机制：业务方提出假设与编码白名单 → 运营方固化 MDOP 模板（投影名、算子摘要、minCell）→ 持有方签署合约并在院内封装 → 节点内计算 → 只发布过闸分层表与确定性事实清单。参与方共同拥有的是「可复现的证据包」（模块字节、计划哈希、证明、回执），而不是互换后的名单。",
        align="justify",
    )
    add_table(
        doc,
        ["场景类别", "价值共创参与方", "所需数据资源（最小投影）", "预期成效", "能力状态"],
        [
            ["疫苗不良反应主动监测（SCRI）", "疾控、医院、空间节点、申办方/疾控免疫规划", "接种日期与疫苗编码；就诊日期与 ICD；假名键、年龄段性别", "风险期/对照期分层计数与精确区间；不交出接种者名单", "TDX 全链路已实测（合成信号）"],
            ["疫苗真实世界保护效果（TND）", "疾控、医院检验、研究方", "接种史；检测日期与阴阳性", "VE=1−OR 及不可估层显式呈现", "本地+TDX 客户机内实测"],
            ["跨院去重发病率与罕见病登记", "≥2 家医院、区域疾控/登记处", "观察起止、事件编码日期、罕见病首诊日", "并集人时与去重病例，避免相加虚增", "本地+TDX 客户机内实测"],
            ["耐药菌监测与跨院信号", "医院检验/药剂、区域 AMR 网", "菌株药敏、折点体系、抗菌药物强度", "可比 R%、折点敏感性、用药—耐药信号；传播链需另立专项", "联邦耐药路径已实现；跨院传播图未作为已交付主张"],
            ["药物警戒失衡信号（RWS L1.5）", "多院药剂/病案、药企安全部门", "四格计数要素（过闸后）", "PRR/ROR 信号，不成行级病历", "已实现"],
            ["跨中心比较效果（L2）与因果生存（L3）", "医院科研、药企医学", "效应量/匹配后汇总；规格锁定防 p-hacking", "可合并的 HR/ATE，证据效度字段入合约", "已实现"],
            ["联邦学习预测（L4）", "医院、模型使用方", "加密梯度，不出原始特征行", "联合模型，原始数据留源", "已实现"],
            ["服务计算（合约期内分步查询）", "持有方、使用方、节点", "密封语料句柄 + 声明式协议与预算", "多次查询不重复明文出域，预算耗尽熔断", "代码与 e2e 已实现，硬件前提同 C2"],
            ["传染病应报未报 / 诊断到报告时滞", "医院、疾控传报", "诊断编码日期 × 报卡日期（假名对齐）", "补齐监测灵敏度", "与 SCRI 同构，试点期开发"],
            ["院感跨院随访、孕产暴露—出生结局、住院—死因补全", "医院、妇幼、死因登记", "手术/用药日期 × 外院感染或分娩/死亡日期", "医防融合刚需", "试点期复制模板，不计入「已完成 10 类」"],
        ],
        col_widths=[3.4, 3.2, 3.4, 3.0, 3.0],
    )
    add_para(
        doc,
        "高价值应用候选（用于冲击「5 个、各 100 家」：须运营侧拓展用户，技术只保证可复制交付）：① AEFI 主动监测服务；② VE 评估服务；③ 区域去重发病统计服务；④ 多中心药物警戒信号服务；⑤ 耐药监测可比口径服务。每类输出均为 C3 分层表 + 存证编号，可供中小医疗机构以「先用后付、按任务」接入。",
        align="justify",
    )

    heading(doc, "（二）数据资源共享流通情况", 2)
    add_para(
        doc,
        "互联互通模式：持有方不上传数据库。目录登记「数据产品」（元数据、分级、投影字段、适用算子），使用方发现后签数字合约。运行时连接器按合约白名单封 SM4 信封，经控制面中继到已证明的节点；节点解封、连接、计数、审查后只回 C3。查询方式：控制台目录检索 + 产品标识；作业与合约、模块 SM3、计划哈希可追溯。对外开放的是「在合约约束下可调用的统计服务」，高质量数据集以「治理后的投影口径 + 答案键对拍」建设，真实数据开放须 rightsConfirmed 与伦理闸门。标识：参与方、连接器、产品、合约、作业采用空间内 URN；跨空间发现走联邦模块的全局 URN 与 CA 信任清单（最小实现，试点期与城市/省级空间做目录互挂）。",
        align="justify",
    )

    heading(doc, "（三）产业生态培育情况", 2)
    add_para(
        doc,
        "合作机制：提供方凭连接器证书与分类分级准入；使用方凭合约目的限制；服务方（实施、审计、算子开发）经第三方 Wasm 准入与角色授权。激励：按队列贡献分账（现状单一代理，试点升级质量×规模×独特性，并预留公共回馈比例）；对中小医院提供标准连接器与模板，降低接入成本；探索「任务完成后分成」而非一次性买断病历。产业培育：CRO 与药企作为使用方带来需求；信息化厂商作为连接器实施方；合规律所与密码测评作为审计清算方。免费试用限于合成演示空间；真实空间必须合约化。第三方 30 家为期末清单管理目标，申报时附意向单位名录【待填】。",
        align="justify",
    )

    heading(doc, "（四）运营方案", 2)
    add_para(
        doc,
        "运营团队（建议编制，【待填姓名】）：空间负责人、合规与伦理岗、连接器客户成功、节点与密码岗（与密钥保管岗分设）、产品经理、审计清算。准入认证：法人核验 + 连接器证书 + 数据分级标签 + 合约模板。合规：用途限制、最小字段、小单元格、销毁、禁止再识别条款写入合约；撤销立即停算。价值评估：定价单元为「用途×交付形态（仅聚合/仅模型）」而非按条卖数；收益分配现状为贡献占比=队列规模，试点按九维价值密度与三层分账升级。授权：合约生命周期管理；争议：作业证据包（证明、回执、抑制清单）作为仲裁事实，流程【待填法务制度】。投资回报：附件 2 要求空间收入不低于总投资 20%。技术侧已具备按任务计价字段，真实收费【待填商务】。测算表须运营财务填写，技术不得编造收入。",
        align="justify",
    )

    heading(doc, "（五）技术方案", 2)
    add_para(
        doc,
        "总体架构：瘦控制面 + 重连接器 + 中立可信空间节点。控制面：身份（SM2 CA）、目录、数字合约与使用控制、MDOP 编译/凭证/调度/合并/销毁编排、结算、长安链存证适配、联邦信任清单。连接器：本地 FHIR/视图接入、去标识与假名、PEP、封装、Wasm 沙箱、输出闸门、仅出站长轮询。节点：TDX 客户机、密封语料、会话证明、发布审查、预算账本、销毁。控制台：空间作业、合约、目录、连接器、审计、结算。",
        align="justify",
    )
    add_table(
        doc,
        ["核心功能（通知）", "实现方式", "对应能力评价要点（TC609 口径）"],
        [
            ["可信管控", "参与方身份、连接器注册、合约签署/解除、PEP、证明登记才允许 C2 放置", "身份、连接器管理、数字合约、空间管理、使用控制"],
            ["资源交互", "数据产品目录、申请与合约化调用、MDOP 片段、C2 中继不解密、C3 合并", "目录管理、连接器接入"],
            ["价值共创", "场景模板 + 可复现算子 + 贡献分账 + 服务协议（多步查询预算）", "开发应用（算子库）、数据交易（计价字段，市场为弱项）"],
            ["安全管理", "国密、分级分类、minCell/罕见病双阈值、DP 预算接口、销毁回执、全流程日志上链哈希", "存证审计、安全"],
        ],
        col_widths=[3.2, 7.0, 5.8],
    )
    add_para(
        doc,
        "与「低成本、轻量化、敏捷化」的匹配：不建设超大中心数据湖；算子以数百至千字节 Wasm 迭代，换口径改模块不改电路；医院侧连接器只出站。已知技术缺口须写进进度：真实 KMS 与生产级密钥治理、连接器重启后的凭证持久化、差分隐私预算在部分路径仍为待接入、跨空间互联未生产化、数据交易市场/需求中心/计费订单为最小或后置。",
        align="justify",
    )

    heading(doc, "（六）互联互通方案", 2)
    add_para(
        doc,
        "拟与省级医疗公共数据空间、城市可信数据空间在「身份互认、目录互发现、合约策略互认、计量凭证互认」四层对接：对方空间能发现本空间上架的统计型数据服务，调用仍经本空间合约与连接器，原始数据不出源机构。跨空间使用管控复用数字合约撤销与 PEP。开源方面：协议、算子构建配方与治理校验脚本可开源，医院真实库与密钥配置不开源。当前代码已有 federation 最小实现（全局 URN、CA 信任清单、拉模式 CRL），试点期选择 1 个区域空间做互认 PoC，不承诺全国互联一次到位。",
        align="justify",
    )

    heading(doc, "（七）进度计划", 2)
    add_table(
        doc,
        ["阶段", "时间（示例，待与申报周期对齐）", "阶段性成果", "社会/经济效益"],
        [
            ["T0 已完成", "申报前", "控制面+连接器+目录合约+RWS 阶梯；AEFI TDX 全链路；VE/去重客户机实测；治理元语与守护", "可演示、可审计的技术底座"],
            ["T1", "试点第 1–6 月", "真实 1 疾控+≥2 医院伦理与连接器上线；SCRI/去重择一用真实口径试运行（结果不对外当流行病学结论直至审批允许）；运营制度与仲裁流程印发", "形成可验收的「明文不出院」样板"],
            ["T2", "第 7–12 月", "场景扩展到漏报监测或院感跨院；算子市场与第三方实施商准入；分账升级质量因子", "降低重复填报与重复计数"],
            ["T3", "第 13–18 月", "5 个高价值服务封装；与 1 个城市/省级空间目录互挂；第三方机构清单达中期数", "带动实施、审计、云服务收入【待测算】"],
            ["T4", "第 19–24 月", "10 类场景、30 项产品服务对账；收入/投资比达标路径复盘；验收材料与复制手册", "形成可向其他病种/区域复制的行业模式"],
        ],
        col_widths=[2.4, 3.4, 6.2, 4.0],
    )

    heading(doc, "（八）保障措施", 2)
    add_para(
        doc,
        "组织：申报单位成立试点工作专班，与卫生健康/疾控/药监条线建立会商（【待填】）。人员：研发与现场实施【待填人数】，密码与合规岗不得兼任密钥释放。资金：投资计划明细表由财务按「控制面云资源、TDX 节点、医院实施、测评与认证、运营」分列【待填】。可持续：连接器标准安装手册已有内部运维文档基础；真实数据走 REG 合规资格闸门，未过闸不得宣称生产。",
        align="justify",
    )
    add_table(
        doc,
        ["投资科目（示例）", "金额（万元）", "说明"],
        [
            ["可信空间节点（TDX）与证明链运维", "【待填】", "与运营主体分设的节点资源"],
            ["控制面与存证链", "【待填】", "含长安链与备份"],
            ["连接器实施（按院）", "【待填】", "现场、适配、培训"],
            ["安全测评 / 密码 / 等保 / 伦理", "【待填】", ""],
            ["生态激励与分账备付", "【待填】", ""],
            ["合计（拟投入）", "【待填，须等于封面总额】", ""],
        ],
        col_widths=[5.5, 4.0, 6.5],
    )


def section6_9(doc):
    heading(doc, "六、申报单位承诺书", 1)
    add_para(
        doc,
        "本单位近 3 年内（2022 年以来）未出现违规、违法行为，未发生重大信息、网络安全事件，重大、特大生产和环境安全事故，本单位不属于失信被执行人。所开展的可信数据空间各类业务和数据流通利用行为合法合规，申报材料内容真实有效。合成数据与注入信号已在材料中标注，不作为真实人群流行病学结论。",
        align="justify",
    )
    add_para(doc, "承诺单位：（盖申报单位公章）　　承诺时间：　　年　　月　　日", first_line=False, space_before=24)

    heading(doc, "七、推荐单位意见", 1)
    add_para(doc, "说明：「推荐单位」为省级数据管理部门或中央企业。", cn="楷体", first_line=False)
    add_para(doc, "审查论证情况：【待填——须写明对主体资格、材料真实性、试点类型是否为行业医疗健康、是否重复申报的审核结论】", first_line=False)
    add_para(doc, "具体意见：【待填】", first_line=False)
    add_para(doc, "推荐单位（盖章）：　　　　年　　月　　日", first_line=False, space_before=24)

    heading(doc, "八、城市人民政府意见", 1)
    note(doc, "本项目申报行业方向，本栏不适用。若改报城市空间须另填并获市政府同意——以当前系统能力不建议改报。")

    heading(doc, "九、国家行业主管部门意见（可选）", 1)
    add_para(doc, "说明：行业空间宜获得国家行业主管部门联合推荐。建议商请卫生健康、疾控或药监条线出具意见。", cn="楷体", first_line=False)
    add_para(doc, "联系人及联系方式：【待填】", first_line=False)
    add_para(doc, "推荐单位（盖章）：　　　　年　　月　　日", first_line=False, space_before=24)


def section10(doc):
    heading(doc, "十、试点相关证明材料（对照清单）", 1)
    add_para(doc, "以下对应通知附件 3「十、试点相关证明材料」。能用仓库与试点证据支撑的已列出路径；法人与财务类须运营单位另行装订。", first_line=False)
    add_table(
        doc,
        ["类别", "通知要求", "可提供的证据（现状）"],
        [
            ["（一）基本材料", "营业执照或法人证书；近 3 年财务状况", "【待填装订】"],
            ["（二）技术基础", "系统关键页面、操作界面", "控制台：空间目录/合约/连接器/MDOP 作业/审计/结算；架构说明见 ARCHITECTURE.md；TDX 截图见 pitch/intel-showcase 与 rws-showcase"],
            ["（二）技术基础", "申报通知日前运行日志", "作业记录与 e2e 日志；TDX 作业号（如 vaccine-scri 全链路）装订打印"],
            ["（三）应用情况", "数据资源、产品、服务", "数据产品种子与场景方案 docs/rws-trusted-space-solution.md；算子库 packages/wasm-algorithms；演示数据须标注合成"],
            ["（四）运营情况", "运营团队、生态合作、规则机制", "数字合约与 PEP、销毁回执链、治理元语；人员任命与合作协议【待填】"],
            ["知识产权", "专利/软著（通知举例）", "【待填证书号】"],
            ["访问地址", "系统地址与账号", "【待填演示环境；生产密钥不得写入申报书】"],
        ],
        col_widths=[3.0, 4.5, 8.5],
    )


def appendix(doc):
    heading(doc, "附录 A　通知正文与三类试点对照（为何只报行业）", 1)
    add_table(
        doc,
        ["类型", "通知要点", "与 MedTrust 匹配"],
        [
            ["企业空间", "龙头主导供应链；开放 ≥20 数据集；200 家上下游；中小企业普惠；收入/投资 ≥10%", "不匹配。本系统不是供应链协同平台。"],
            ["行业空间", "医疗等行业；共建共治；≥5 库、10 类场景、30 产品；份额 30%、第三方 30 家；收入/投资 ≥20%", "匹配方向（附件 1 第 8 条医疗健康）。量化指标作为两年目标。"],
            ["城市空间", "公共数据 ≥60%、产品 ≥2000、场景 ≥100、政府部门覆盖 50%", "不匹配。无城市公共数据目录体量。"],
        ],
        col_widths=[2.8, 7.2, 6.0],
    )
    heading(doc, "附录 B　附件 1 第 8 条（医疗健康方向）逐句响应", 1)
    add_table(
        doc,
        ["指引原文要素", "系统响应"],
        [
            ["联合头部医疗机构、科研机构、生物医药与人工智能企业", "医院连接器 + 药企使用方 + 研究模板；AI 侧目前是结果解读小模型与联邦学习，不是诊疗大模型训练平台"],
            ["基因等多组学、临床医疗、公共卫生等数据资源共享", "临床与公卫（疾控接种）已打通拓扑；多组学未作为已交付场景，试点可单列、须更高伦理门槛"],
            ["新药靶点智能筛选", "未建设，禁止填入「已开展」"],
            ["精准诊疗大模型研发", "未作为主路径；L4 联邦学习是预测通道，不得改写成已有诊疗大模型"],
            ["医疗资源区域调度", "未建设"],
            ["医药健康「数据-研发-服务-产业」全链条", "已打通的是「数据不出域的研发证据（RWE/公卫监测）-合约服务-分账」；产业规模化属试点目标"],
        ],
        col_widths=[6.0, 10.0],
    )
    heading(doc, "附录 C　系统能力总表（供答辩一页纸）", 1)
    add_table(
        doc,
        ["能力", "状态", "对外怎么说"],
        [
            ["联邦连接器 / 数据不出域", "已实现", "原始记录留源，跨域仅密文投影与过闸聚合"],
            ["身份与国密通道", "已实现", "SM2/SM3/SM4"],
            ["目录与数字合约、使用控制", "已实现", "用途与字段锁在合约，撤销即停"],
            ["MDOP 编排与 C2 节点", "已实现；生产依赖真实证明与 KMS", "证明有效才放置；无硬件不得虚标 TEE"],
            ["疫苗 SCRI", "TDX 真跑", "合成数据+注入信号"],
            ["VE-TND / 跨院去重", "客户机内实测", "同上"],
            ["RWS L1.5–L4", "已实现", "药物警戒到联邦学习阶梯"],
            ["输出闸门与销毁回执", "已实现", "小单元格抑制；销毁可核验"],
            ["长安链存证", "已实现（solo 等残留）", "只存哈希"],
            ["结算分账", "最小实现", "队列规模代理，须升级"],
            ["跨空间互联", "最小实现", "试点期 PoC"],
            ["数据交易市场 / 真实支付", "后置", "不写入「已具备」"],
        ],
        col_widths=[4.5, 5.5, 6.0],
    )
    heading(doc, "附录 D　附件 4 推荐项目汇总表（单行草稿）", 1)
    add_table(
        doc,
        ["栏目", "填写"],
        [
            ["申报单位", "【待填】"],
            ["可信数据空间名称", "医疗健康可信数据空间（MedTrust）"],
            ["类型", "行业（医疗健康）"],
            ["试点内容简述（200 字内）", "建设医院与疾控连接器加中立可信执行节点的医疗行业空间，原始数据不出源。以数字合约约束用途与字段，在节点内完成接种—就诊等逐人协同计算，只发布过闸统计。已形成疫苗不良事件监测、保护效果评估、跨院发病去重、耐药监测及真实世界研究阶梯，探索可复制的医防数据流通与贡献分账模式。"],
            ["项目资金（万元）", "【待填】"],
            ["联系人", "【待填】"],
        ],
        col_widths=[4.0, 12.0],
    )
    heading(doc, "附录 E　源通知结构索引", 1)
    add_para(
        doc,
        "原文 PDF：docs/P020250411524209271991.pdf（27 页）。第 1–7 页通知正文；附件 1 行业参考指引（医疗健康为第 8 条）；附件 2 企业/行业/城市要素条件；附件 3 三类申报书封面与填写栏目（本稿主体）；附件 4 推荐汇总表。联系电话（通知载明）：010-89062536、010-89062312、010-89062538。邮寄：国家数据局数据资源司（北京市西城区月坛北小街 2 号院 1 号楼），信封注明「可信数据空间试点项目申报」。",
        align="justify",
    )


def main():
    doc = setup_doc()
    cover(doc)
    doc.add_page_break()
    section0(doc)
    section_notice(doc)
    section1(doc)
    section2(doc)
    section3(doc)
    section4(doc)
    section5(doc)
    section6_9(doc)
    section10(doc)
    appendix(doc)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    print(f"wrote {OUT} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
