from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(
    0,
    str(ROOT.parent / "rwd-production-single-arm-20261017-r3"),
)
import report_helpers as H  # noqa: E402
from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.shared import Pt  # noqa: E402

SHOTS = ROOT / "screenshots"
OUTPUT = ROOT / "RWD单臂外部对照生产链路复测报告.docx"

with (ROOT / "data" / "ui-preflight-r5.json").open(encoding="utf-8") as handle:
    UI_RUN = json.load(handle)
FINAL = UI_RUN["detail"]
with (ROOT / "data" / "ai-preflight-r5.json").open(encoding="utf-8") as handle:
    RUN = json.load(handle)
with (ROOT / "data" / "contract-evidence-r5.json").open(encoding="utf-8") as handle:
    CONTRACT_EVIDENCE = json.load(handle)
with (ROOT / "data" / "run.json").open(encoding="utf-8") as handle:
    NEGATIVE = json.load(handle)

JOB = FINAL["job"]["id"]
PLAN_HASH = FINAL["job"]["planHash"]
TICKET = FINAL["ticket"]["ticketId"]
TRIAL_CONTRACT = next(
    item for item in CONTRACT_EVIDENCE["contracts"]
    if item["id"] == "56dc0834-c30b-4970-a7ed-735cebdf8435"
)
CONTROL_CONTRACT = next(
    item for item in CONTRACT_EVIDENCE["contracts"]
    if item["id"] == "f06ce079-4a7e-4608-be78-b57fa3b07e90"
)
CREATED_AT = FINAL["job"]["createdAt"]
UPDATED_AT = FINAL["job"]["updatedAt"]
BUNDLE = FINAL["job"]["contractBundle"]
ANCHOR_BLOCKS = [item["payload"]["block"] for item in FINAL.get("anchors", [])]
ANCHOR_TEXT = "–".join(str(value) for value in (ANCHOR_BLOCKS[:1] + ANCHOR_BLOCKS[-1:]))
PHARMA_ACCOUNT = "pv@demo-pharma.example / demo123456"
HUASHAN_ACCOUNT = "admin@huashan-hospital.com / demo123456"
RUIJIN_ACCOUNT = "admin@rjh.com.cn / demo123456"


def cover(doc: Document):
    H.add_paragraph(
        doc,
        "生产验证报告",
        size=10,
        color=H.TEAL,
        bold=True,
        space_before=18,
        space_after=54,
    )
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run("RWD 单臂外部对照生产链路复测报告")
    H.set_run_font(run, H.FONT_CN, 30, "000000", True)
    H.add_paragraph(
        doc,
        "从使用方登录到双院封存、TDX 节点内匹配、发布审查、销毁与链上锚定的完整复测",
        size=13.5,
        color="000000",
        space_after=26,
        line_spacing=1.3,
    )
    H.add_paragraph(
        doc,
        "本轮于 2026-10-17 在生产入口重新执行“药企自然语言 → 统一 AI 助手 → 参数卡 → 双合约预检 → "
        "MDOP 作业 → 销毁与锚定”的完整链路。作业使用华山 460 例合成试验数据与瑞金 5,600 例合成历史对照数据，"
        f"正式成功作业为 {JOB}，终态 PURGED。报告同时保留此前执行链证据与本轮修复后的页面复测。",
        size=11,
        space_after=20,
        line_spacing=1.35,
    )
    table = H.add_metadata_table(
        doc,
        [
            ("生产入口", "https://web.szchada.top"),
            ("控制面 API", "https://api.szchada.top/api/v1"),
            ("作业标识", JOB),
            ("作业终态", f"PURGED，{UPDATED_AT}"),
            ("ContractBundle", f"{BUNDLE['id']} / {BUNDLE['version']}"),
            ("证据时间", "2026-10-17 15:34–15:37 PDT / 22:34–22:37 UTC"),
            ("报告版本", "V2.0"),
        ],
    )
    H.repeat_header(table.rows[0])
    H.add_paragraph(
        doc,
        "编制 MedTrust 生产验证小组",
        size=9.5,
        color=H.MUTED,
        space_before=22,
        space_after=2,
    )


def executive_summary(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "执行结论", 1)
    H.add_paragraph(
        doc,
        "本轮生产执行链与页面 AI 入口均通过。药企从统一助手自然语言发起的新作业完成六阶段执行，华山与瑞金分别完成本地取数和 C2 封存，"
        "tee-node-a 在 TDX 环境内完成分层匹配与最小单元格审查，平台合并 C3，收齐三个节点的销毁回执后进入 PURGED。"
        "四个分层全部达到匹配规模要求，匹配总数 460，未匹配 0，发布抑制 0。",
    )
    H.add_data_table(
        doc,
        ["检查项", "本轮实际结果", "判断"],
        [
            ["使用方身份与产品可见性", "pharma-demo 可见华山 460 例与瑞金 5,600 例两个产品", "通过"],
            ["既有双签合约", "56dc0834 / f06ce079 均为 active / active，允许外部对照与 small-cell 算子", "通过"],
            ["作业提交与编译", "返回 6 阶段计划，plan_hash 生成，切成 3 个节点片段", "通过"],
            ["院内取数与封存", "华山、瑞金 source 与 seal 共 4 阶段均一次成功", "通过"],
            ["TDX 节点执行", "KMS 放钥、两院会话见证核验、匹配与发布审查成功", "通过"],
            ["结果完整性", "4 个分层匹配合计 460，未匹配 0，抑制 0", "通过"],
            ["销毁与审计", f"三个节点均返回销毁回执，回执链 3/3 连续，锚定到 block {ANCHOR_TEXT}", "通过"],
            ["AI 助手配置入口", "自然语言生成确定性参数卡，双 active 合约判定 ready，提交后作业 PURGED", "通过"],
            ["ContractBundle 绑定", f"{BUNDLE['id']} 同时绑定两份成员合约与四个源/封存阶段", "通过"],
            ["药物注册用途 30 天合约窗口", "负例作业被华山连接器以 E_CONTRACT_EXPIRED 拒绝", "正确拒绝"],
        ],
        widths=[1.55, 4.25, 0.9],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
    )
    H.add_heading(doc, "结论边界", 2)
    H.add_bullet(doc, "可确认的是：生产控制面、两家医院连接器、TDX 节点、链服务与发布审查在同一作业内协同完成，并能按合约和证明策略拒绝不合规请求。")
    H.add_bullet(doc, "页面 AI 助手已能把自然语言需求固定到场景声明，并在参数确认后逐源检查两份真实 active 合约，不再由模型生成用途编码。")
    H.add_bullet(doc, "本轮实际执行使用“对话式任务配置”用途的双签合约；药物注册业务用途仍未替代为临床或监管结论。")
    H.add_bullet(doc, "全部数据为合成数据。匹配计数和发布审查结果只能证明平台链路与控制点有效，不构成疗效、安全性或监管结论。")


def background(doc: Document):
    H.add_heading(doc, "场景背景与业务价值", 1)
    H.add_heading(doc, "单臂试验为什么需要外部对照", 2)
    H.add_paragraph(
        doc,
        "单臂试验只有接受试验干预的人群，没有同期内部随机对照。罕见病、严重疾病或伦理上不适合设置安慰剂组的场景，"
        "会考虑使用其他机构的历史真实世界数据构建外部对照臂。外部对照能否使用，取决于人群定义、时间零对齐、分层变量、"
        "匹配窗口、结局定义与偏倚控制。",
    )
    H.add_paragraph(
        doc,
        "本轮把华山试验点的 460 例单臂受试者与瑞金的 5,600 例历史病例作为两个独立数据源。两者先在各院生成最小封存投影，"
        "再送到可信空间节点内按年龄带与性别分层，使用 30 天卡尺和 2:1 匹配比例完成匹配。平台只看到分层计数和发布清单。",
    )
    H.add_heading(doc, "业务价值", 2)
    H.add_bullet(doc, "药企可以在投入前瞻性对照招募前，先评估外部对照的样本可得性、分层覆盖和匹配规模。")
    H.add_bullet(doc, "医院保留原始行，只把最小字段投影封存后送到受控节点；平台不获得可重识别记录。")
    H.add_bullet(doc, "用途、有效期、允许算子与 TEE 证明策略都写进双签合约，节点按本地副本复核，平台不能单方面改写。")
    H.add_bullet(doc, "结果发布经过最小单元格审查，销毁回执和链上锚定提供可复核的收尾证据。")
    H.add_heading(doc, "本轮验证目标", 2)
    H.add_data_table(
        doc,
        ["目标", "验证方式", "通过标准"],
        [
            ["双院数据参与", "华山与瑞金分别执行 source 与 seal", "两侧均成功且对应各自合约"],
            ["C2 边界", "两院只向 tee-node-a 提交密文信封", "平台无原始行，节点完成会话见证核验"],
            ["匹配口径", "30 天卡尺、2:1、四个年龄性别分层", "各层有匹配结果且未匹配可解释"],
            ["发布审查", "合约 minCell=5", "发布清单给出抑制数与阈值"],
            ["销毁", "平台发 PurgeOrder", "三节点回执收齐后才进入 PURGED"],
            ["审计", "校验三节点回执链并锚定链头", "三条链连续并得到链上交易与区块"],
        ],
        widths=[1.1, 2.8, 2.8],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )


def environment(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "生产环境、入口与测试账号", 1)
    H.add_paragraph(
        doc,
        "页面入口为 https://web.szchada.top，生产控制面 API 为 https://api.szchada.top/api/v1。"
        "本轮公网登录页、静态资源和 chat-agent 均从生产域名直接访问；页面、API、数据库、连接器与 TDX 节点未切换到本地测试实例。"
        "报告中的账户与口令均为演示验证账号。",
    )
    H.add_heading(doc, "账号与角色", 2)
    H.add_data_table(
        doc,
        ["角色", "登录账号", "密码", "参与方", "本轮用途"],
        [
            ["药企 PV 研究员", "pv@demo-pharma.example", "demo123456", "pharma-demo", "发起并查看外部对照作业"],
            ["华山医院管理员", "admin@huashan-hospital.com", "demo123456", "p-huashan", "验证试验臂合约与提供方入口"],
            ["瑞金医院管理员", "admin@rjh.com.cn", "demo123456", "p-ruijin", "验证对照臂合约与提供方入口"],
        ],
        widths=[1.1, 1.78, 1.05, 0.85, 1.72],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 5,
    )
    H.add_paragraph(
        doc,
        "AI 助手先返回确定性参数卡，再按用户确认的两组参与方/数据产品检查产品级访问授权与两份 active / active 合约。"
        "本轮未重新签发合约；合约有效性证据直接来自生产 `GET /contracts` 响应。",
        size=10,
        color=H.MUTED,
    )
    H.add_heading(doc, "数据产品与执行参数", 2)
    H.add_data_table(
        doc,
        ["项目", "取值", "作用"],
        [
            ["试验方", "p-huashan / 40ff788a-89e7-4601-9981-9b9b962d509e", "单臂试验受试者，460 例"],
            ["对照方", "p-ruijin / 99bd8b08-6a69-457f-8063-2bde919ea413", "历史对照池，5,600 例"],
            ["可信空间节点", "urn:tds:sh-med:participant:tee-node-a", "KMS 放钥、匹配、发布审查"],
            ["分层键", "18-39|M、18-39|F、40-64|M、40-64|F", "年龄带 × 性别"],
            ["匹配卡尺", "30 天", "限制索引日距离"],
            ["匹配比例", "2:1", "每名试验受试者最多匹配两名对照"],
            ["最小单元格", "5", "发布审查阈值"],
        ],
        widths=[1.3, 3.15, 2.25],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )
    H.add_heading(doc, "关键对象", 2)
    H.add_data_table(
        doc,
        ["对象", "标识"],
        [
            ["试验臂合约", TRIAL_CONTRACT["id"]],
            ["对照臂合约", CONTROL_CONTRACT["id"]],
            ["作业", JOB],
            ["plan_hash", PLAN_HASH],
            ["执行凭证", TICKET],
            ["ContractBundle 版本", BUNDLE["version"]],
            ["负例作业", NEGATIVE["timeline"][-1]["job"]["id"]],
        ],
        widths=[1.5, 5.0],
        first_col_fill=H.PALE_BLUE,
    )


def chain(doc: Document):
    H.add_heading(doc, "生产链路与控制点", 1)
    H.add_paragraph(
        doc,
        "链路的顺序是数据授权与合约、控制面编译、各院本地取数与封存、可信节点执行、结果发布、销毁与审计。"
        "每一步都由不同服务执行，后一步依赖前一步的签名或回执，不在单进程内跳过。",
    )
    H.add_data_table(
        doc,
        ["顺序", "控制点", "责任服务", "实际动作", "本轮结果"],
        [
            ["1", "身份与目录", "AuthService · CatalogService", "认证药企，读取两个数据产品元数据", "通过"],
            ["2", "双签合约", "ContractService", "读取既有 active / active 合约，校验用途和允许算子", "通过"],
            ["3", "作业提交", "MdopController · MdopJobsService", "展开 6 阶段计划，写入作业与阶段", "SUBMITTED"],
            ["4", "编译与要约", "MdopJobsService · MdopTicketService", "重验合约和 TDX 策略，生成 plan_hash 与三节点片段", "NEGOTIATING"],
            ["5", "院内取数与封存", "rws-worker-a / rws-worker-b", "本地加载数据、生成最小投影、封装 C2 信封", "4 阶段成功"],
            ["6", "节点内执行", "tee-node-a", "KMS 放钥、匹配、最小单元格发布审查", "2 阶段成功"],
            ["7", "结果合并", "MdopMergeService", "接收 C3、合并、写入交付物", "SUCCEEDED"],
            ["8", "销毁与审计", "MdopPurgeService · ReceiptChainService", "发 PurgeOrder、收齐回执、校链并锚定", "PURGED"],
        ],
        widths=[0.42, 1.25, 1.9, 2.6, 1.0],
        font_size=8.0,
        alignments=[
            WD_ALIGN_PARAGRAPH.CENTER,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.CENTER,
        ],
    )
    H.add_heading(doc, "作业时间线", 2)
    H.add_data_table(
        doc,
        ["时间 UTC", "状态或事件", "证据"],
        [
            ["22:34:24", "统一助手的参数卡提交后写入 6 阶段逻辑计划", JOB],
            ["22:34:24", "编译成功，生成 plan_hash，进入 NEGOTIATING", PLAN_HASH],
            ["22:35:00", "华山 source.dataset 成功", "stage src_phuashan"],
            ["22:35:02", "瑞金 source.dataset 成功", "stage src_pruijin"],
            ["22:35:26", "华山 seal.envelope 成功并提交 C2 信封", "stage seal_phuashan"],
            ["22:35:29", "瑞金 seal.envelope 成功并提交 C2 信封", "stage seal_pruijin"],
            ["22:35:56", "tee-node-a 外部对照匹配完成", "stage extCtl"],
            ["22:36:34", "发布审查与 C3 回传，平台合并为 SUCCEEDED", "stage decTee"],
            ["22:37:05", "三节点销毁回执收齐，作业进入 PURGED", "chains 3/3"],
            ["完成后", f"三节点回执链头锚定到 block {ANCHOR_TEXT}", "anchors 3/3"],
        ],
        widths=[1.05, 3.7, 1.95],
        alignments=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )


STEPS = [
    dict(
        no="01",
        title="药企登录生产入口",
        shot="01-login-pharma-filled.png",
        caption="图 1  药企账号与密码已填入生产登录页",
        account=PHARMA_ACCOUNT,
        entry="https://web.szchada.top/login → 账号密码登录",
        service="控制面认证服务（POST /api/v1/auth/login）",
        action="校验账号、口令和一次性图形验证码，绑定 pharma-demo 与 consumer 角色，签发控制台会话。",
        result="登录成功，进入创新药企 PV 研究员的数据使用方视图。",
    ),
    dict(
        no="02",
        title="确认药企身份与空间",
        shot="02-login-pharma-success.png",
        caption="图 2  药企身份、空间与原始数据出域计数",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="工作台 → 空间总览",
        service="Space Overview",
        action="汇总空间 sh-med 的产品、连接器、合约、任务与通知，并渲染用户身份。",
        result="左下角显示“创新药企 PV 研究员 · 数据使用方”和“原始数据出域 0 行”。",
    ),
    dict(
        no="03",
        title="查看试验组与对照组数据产品",
        shot="03-data-catalog.png",
        caption="图 3  数据产品目录只展示元数据",
        shots=[
            ("03-data-catalog.png", "图 3  数据产品目录首屏只展示元数据"),
            ("03a-trial-dataset.png", "图 3a  滚动到目录末尾核验华山试验产品 460 行"),
            ("03b-control-dataset.png", "图 3b  同一列表末尾核验瑞金历史对照产品 5,600 行"),
        ],
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="数据与合约 → 数据产品",
        service="DataProduct Catalog",
        action="返回产品标题、分级、提供方、行数和本地路径元数据。",
        result="目标产品位于列表后部，需要滚动到末尾；华山 460 行、瑞金 5,600 行及产品 ID 均可见。页面不展示原始数据行是目录设计约束，不是缺陷。",
    ),
    dict(
        no="04",
        title="核对双签合约状态",
        shot="04-contracts.png",
        caption="图 4  数字合约页展示使用方可见合约与生效状态",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="数据与合约 → 数字合约",
        service="ContractService",
        action="按调用者参与方过滤合约，渲染用途、留存、最小单元格与 MDOP 快照状态。",
        result="用于本轮作业的两份合约为 active / active。合约 ID 与签名在服务端响应中核对。",
    ),
    dict(
        no="05",
        title="从全局工具位进入统一 AI 助手",
        shot="05-ai-global-entry-r5.png",
        caption="图 5  侧栏常驻“询问 AI”，不依附研究与任务分区",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="任意业务页 → 侧栏全局工具位 → /space/assistant",
        service="chat-agent（POST /chat-agent/api/v1/chat/stream）",
        action="统一入口按角色路由到访问与合约助手；研究设计与结果解读共享同一会话体系。",
        result="全局入口可见；旧 `/space/chat` 永久重定向到 `/space/assistant`。",
    ),
    dict(
        no="06",
        title="AI 助手返回参数卡并提交双院作业",
        shot="06-ai-form-card-r5.png",
        caption="图 6  AI 助手确定性参数卡与真实目录候选",
        shots=[
            ("06-ai-form-card-r5.png", "图 6  AI 助手确定性参数卡与真实目录候选"),
            ("07-ai-form-filled-r5.png", "图 6a  药企选择华山试验臂、瑞金对照臂与 tee-node-a"),
            ("08-ai-submitted-r5.png", "图 6b  两成员合约预检通过并返回作业号"),
        ],
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="AI 助手 → 自然语言 → 参数卡 → 提交",
        service="场景路由 · check_data_access · check_contract_status · submit_external_control",
        action="服务端先返回固定参数卡；用户提交后按两个数据源逐项匹配各自的 active 合约，生成 ContractBundle 并提交。",
        result="华山 56dc0834 与瑞金 f06ce079 均判定 ready；作业含 contractBundleId/version、两份成员合约与逐阶段绑定。",
    ),
    dict(
        no="07",
        title="生产作业终态与六阶段摘要",
        shot="09-ai-job-overview-r5.png",
        caption="图 7  AI 提交作业终态 PURGED 与六阶段执行结果",
        shots=[
            ("09-ai-job-overview-r5.png", "图 7  AI 提交作业终态 PURGED 与六阶段执行结果"),
            ("13-contract-bundle-detail-r5.png", "图 7a  作业详情中的 ContractBundle 与逐阶段成员绑定"),
        ],
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="研究与任务 → 编排任务 → /space/mdop/jobs/" + JOB,
        service="MdopController · MdopJobsService",
        action="读取作业、阶段、片段、执行凭证、会话见证、结果和回执链状态。",
        result="状态 PURGED；六阶段均为 SUCCEEDED，尝试次数均为 1。",
    ),
    dict(
        no="08",
        title="校验执行凭证与 TDX 期望",
        shot="11-job-witness-r5.png",
        caption="图 8  执行凭证与三家节点的会话证明核验",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="作业详情 → 执行凭证 / 会话证明与本院核验",
        service="MdopAttestationService · 华山与瑞金 connector",
        action="冻结 TDX 代码度量与 TCB 期望；校验 KMS 会话见证，并由持有方上报核验结论。",
        result="两院各有一条 verified 见证，均由 kms://verifier-domain-b 签名，节点无缺证状态。",
    ),
    dict(
        no="09",
        title="查看匹配结果与发布审查",
        shot="10-ai-job-result-r5.png",
        caption="图 9  AI 提交作业的四层外部对照结果与发布审查",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="作业详情 → 合并结果（C3 交付物）与发布审查",
        service="MdopMergeService · tee-node-a",
        action="接收节点 C3，记录分层计数、minCell、抑制数、DP 声明与预算。",
        result="匹配 460、未匹配 0、发布抑制 0；三节点回执链均连续并已锚定。",
    ),
    dict(
        no="10",
        title="在任务列表中复核作业",
        shot="12-task-list-r5.png",
        caption="图 10  统一任务列表中的生产作业",
        account=f"{PHARMA_ACCOUNT}（当前会话）",
        entry="研究与任务 → 编排任务",
        service="Task List",
        action="汇总 MDOP、RWS、联邦任务，并按任务 ID 链接到对应详情页。",
        result="作业可按 ID 找到并进入同一详情页，状态与详情一致。",
    ),
    dict(
        no="11",
        title="双臂目标合约生产响应逐项核验",
        shot="11-contract-evidence-r5.png",
        caption="图 11  生产 GET /contracts 的两份 active / active 成员合约",
        account=HUASHAN_ACCOUNT,
        entry="生产 API GET /contracts（药企调用者视角）",
        service="ContractService",
        action="按 ID 定位两份本轮成员合约，核验提供方、使用方、用途、mdopStatus、签名、有效期、允许算子与 minCell。",
        result="56dc0834 对应 p-huashan；f06ce079 对应 p-ruijin；两份均 active / active、持有方签名、平台副署，minCell=5。",
    ),
    dict(
        no="12",
        title="医院角色入口辅助复核",
        shot="15-ruijin-contracts.png",
        caption="图 12  瑞金医院管理员角色入口（仅证明入口可用，不作目标合约有效性证据）",
        account=RUIJIN_ACCOUNT,
        entry="https://web.szchada.top/login → 数据与合约 → 数字合约",
        service="AuthService · ContractService",
        action="认证 p-ruijin 提供方管理员并打开合约页；目标合约字段以图 11 的生产 API 响应为准。",
        result="角色入口可用；旧胰岛素/旧研究合约不用于本轮有效性证明。",
    ),
    dict(
        no="13",
        title="服务分工与数据控制点",
        shot="16-service-chain.png",
        caption="图 13  生产服务、双签合约、数据规模与后台动作总览",
        account=f"{PHARMA_ACCOUNT}（发起与读取）",
        entry="生产控制面与两家医院连接器",
        service="MdopController · MdopJobsService · ContractService · rws-worker-a/b · tee-node-a",
        action="按合约与证明策略完成计划编译、院内封存、节点执行和平台合并。",
        result="场景路由、逐源合约包、六阶段结果、plan_hash 与 ContractBundle 版本均可在图中逐项核对。",
    ),
    dict(
        no="14",
        title="TDX 证明与分层匹配结果",
        shot="17-tdx-and-result.png",
        caption="图 14  TDX 会话证明、四个分层匹配与发布审查",
        account=f"{PHARMA_ACCOUNT}（发起人）",
        entry="tee-node-a 会话证明与 C3 交付物",
        service="tee-node-a · KMS verifier-domain-b · 华山 / 瑞金 connector",
        action="核验同一代码度量与 TCB；节点内完成 30 天卡尺、2:1 匹配并执行 minCell=5 审查。",
        result="四层合计匹配 460、未匹配 0、抑制 0；结果为合成数据的平台流程证据。",
    ),
    dict(
        no="15",
        title="销毁回执、链上锚定与修复结果",
        shot="18-purge-and-audit.png",
        caption="图 15  三节点销毁、回执链锚定和本轮修复结果",
        account=f"{PHARMA_ACCOUNT}（发起人）",
        entry="作业详情 → 审计回执链与锚定",
        service="MdopPurgeService · ReceiptChainService · ChainMaker",
        action="收齐三个节点回执，校验链连续性并把链头上链。",
        result=f"作业 PURGED；三链均连续；block {ANCHOR_TEXT} 分别完成锚定。",
    ),
]


def add_steps(doc: Document):
    H.add_heading(doc, "逐项测试步骤与截图", 1)
    H.add_paragraph(
        doc,
        "以下按实际操作和复核顺序列出 15 个步骤。每一步说明登录账号、入口、后台服务或 Agent、后台动作、作用与结果，"
        "并附生产页面或生产 API 数据生成的证据截图。",
    )
    for step in STEPS:
        H.add_heading(doc, f"{step['no']}  {step['title']}", 1)
        H.add_data_table(
            doc,
            ["项目", "内容"],
            [
                ["登录账号 / 密码", step["account"]],
                ["入口", step["entry"]],
                ["后台服务 / Agent", step["service"]],
                ["后台动作与作用", step["action"]],
                ["本轮结果", step["result"]],
            ],
            widths=[1.2, 5.3],
            font_size=8.4,
            first_col_fill=H.PALE_BLUE,
        )
        figures = step.get("shots") or [(step["shot"], step["caption"])]
        for filename, caption in figures:
            H.add_figure(
                doc,
                SHOTS / filename,
                caption,
                max_width=5.6,
                max_height=3.6,
            )


def findings(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "问题、边界与建议", 1)
    H.add_paragraph(
        doc,
        "本轮执行链和页面入口均通过。此前记录的合约误拦、用途漂移和外部静态资源不可用已在本轮复测中关闭；"
        "模板对任意调用方 notAfter 的收紧校验仍属于后续通用入口改进。",
    )
    H.add_data_table(
        doc,
        ["编号", "问题与证据", "影响", "建议"],
        [
            [
                "F1",
                "双院各有一份 active 合约时曾被误判 missing。",
                "用户无法生成参数卡。",
                "已关闭：逐数据源 requirements 与 ContractBundle 矩阵回归通过，2 / 2 ready。",
            ],
            [
                "F2",
                "AI 用途标签曾由模型自由生成并与合约 purposeCode 漂移。",
                "形成 E_PURPOSE_MISMATCH 或假缺合约。",
                "已关闭：用途来自 ScenarioDefinition.purposePolicy，首次场景命中先返回确定性参数卡。",
            ],
            [
                "F3",
                "通用模板入口对调用方自填 notAfter 的收紧校验仍未统一。",
                "非 AI 入口在极端窗口下仍可能被合约硬闸拒绝。",
                "后续将窗口收紧校验下沉到共享模板校验层；本轮 AI 路径使用默认 90 天窗口且位于共同有效期内。",
            ],
            [
                "F4",
                "此前公网 Web 静态资源出现超时。",
                "外部用户可能无法稳定打开页面。",
                "本轮公网登录页、静态资源、API 与 chat-agent 均直接访问成功；继续保留外部可用性探针。",
            ],
        ],
        widths=[0.5, 2.55, 1.75, 2.0],
        font_size=8.0,
        alignments=[
            WD_ALIGN_PARAGRAPH.CENTER,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.LEFT,
            WD_ALIGN_PARAGRAPH.LEFT,
        ],
    )
    H.add_heading(doc, "执行链判断", 2)
    H.add_bullet(doc, "控制面、连接器、节点、KMS 校验与链服务的端到端执行已通过本轮新作业验证，且作业从提交到 PURGED 的时间、阶段、回执与区块均可追溯。")
    H.add_bullet(doc, "页面 AI 助手、双合约预检、ContractBundle 提交和结果页已在本轮同一生产作业中形成闭环。")
    H.add_bullet(doc, "药物注册业务结论仍需在对应注册用途合约和正式研究方案下另行验证，不能由技术验证用途替代。")


def final_summary(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "总结", 1)
    H.add_paragraph(
        doc,
        "本轮生产复测完成了单臂外部对照的核心执行链。药企身份、目录、合约、六阶段计划、两院本地封存、"
        "TDX 节点内匹配、发布审查、C3 合并、销毁和审计锚定均有本轮新证据。最终作业为 "
        f"{JOB}，状态 PURGED，匹配 460，未匹配 0，发布抑制 0。",
    )
    H.add_heading(doc, "已经验证", 2)
    H.add_bullet(doc, "两院数据在各自连接器内完成取数与最小投影封存，平台未接触原始行。")
    H.add_bullet(doc, "TDX 节点使用同一代码度量与 TCB 5.1.3，华山与瑞金均完成会话见证核验。")
    H.add_bullet(doc, "四个分层全部有匹配结果，发布审查按 minCell=5 执行并记录未加噪事实。")
    H.add_bullet(doc, f"三节点销毁回执收齐后才进入 PURGED，三条回执链连续并锚定到 block {ANCHOR_TEXT}。")
    H.add_bullet(doc, "节点对超窗合约执行 fail-closed，证明合约有效期不是平台侧装饰性检查。")
    H.add_heading(doc, "本轮关闭的问题", 2)
    H.add_paragraph(
        doc,
        "AI 助手不再在参数确认前猜测参与方、数据产品、用途或合约。自然语言命中场景后先返回确定性参数卡；"
        "用户提交后由服务端生成两条合约 requirements，按成员逐项匹配并形成 ContractBundle。",
    )
    H.add_heading(doc, "下一步", 2)
    H.add_bullet(doc, "继续用真实业务用途合约执行注册场景回归，保持数据产品、用途与合约逐项对账。")
    H.add_bullet(doc, "将 Web、API、chat-agent、静态资源与卡片提交纳入常态外部可用性探针。")
    H.add_bullet(doc, f"后续结果可与本轮 {JOB} 的 plan_hash、ContractBundle 版本和六阶段结果逐项对照。")


def appendix(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "附录", 1)
    H.add_heading(doc, "结果明细", 2)
    H.add_data_table(
        doc,
        ["分层", "试验阳性", "试验阴性", "对照阳性", "对照阴性", "匹配", "未匹配"],
        [
            [
                row["key"],
                str(row["mExpPos"]),
                str(row["mExpNeg"]),
                str(row["ctlPos"]),
                str(row["ctlNeg"]),
                str(row["matched"]),
                str(row["unmatched"]),
            ]
            for row in FINAL["result"]["strata"]
        ]
        + [["合计", "106", "354", "313", "607", "460", "0"]],
        widths=[1.1, 0.9, 0.9, 0.9, 0.9, 0.8, 0.8],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] + [WD_ALIGN_PARAGRAPH.CENTER] * 6,
    )
    H.add_heading(doc, "证据文件", 2)
    H.add_data_table(
        doc,
        ["文件", "内容"],
        [
            ["data/run-r4-success.json", "上一轮后端执行链历史证据（不是本轮 AI 成功证据）"],
            ["data/job-final-anchored.json", "上一轮终态作业历史证据（不与本轮对象混用）"],
            ["data/ui-preflight-r5.json", "本轮页面 AI 提交、终态作业、六阶段、凭证、见证、结果、回执链和锚定"],
            ["data/ai-preflight-r5.json", "同一自然语言场景的 API 级 AI 复测与 ContractBundle 载荷"],
            ["data/contract-evidence-r5.json", "生产 GET /contracts 的两份目标成员合约原样响应"],
            ["data/run.json", "合约窗口负例与 E_CONTRACT_EXPIRED 记录"],
            ["screenshots/03a / 03b", "滚动到目录末尾后的华山与瑞金目标产品"],
            ["screenshots/05–10 *-r5.png", "全局 AI 入口、参数卡、填写、提交与作业详情"],
            ["screenshots/11-contract-evidence-r5.png", "双臂目标合约生产响应证据板"],
            ["screenshots/16–18", "服务链、TDX 与结果、销毁与审计的接口级证据板"],
        ],
        widths=[2.45, 4.05],
        font_size=8.4,
    )
    H.add_heading(doc, "访问与配置说明", 2)
    H.add_paragraph(
        doc,
        "本轮截图直接从 https://web.szchada.top 取得；API 与 chat-agent 分别由 https://api.szchada.top "
        "的 /api/v1 与 /chat-agent/api/v1 提供。业务数据、作业、合约、连接器和节点均为 ali29 生产实例。",
        size=9.5,
        color=H.MUTED,
    )


def main():
    doc = Document()
    H.style_document(doc)
    cover(doc)
    executive_summary(doc)
    background(doc)
    environment(doc)
    chain(doc)
    add_steps(doc)
    findings(doc)
    final_summary(doc)
    appendix(doc)
    props = doc.core_properties
    props.title = "RWD 单臂外部对照生产链路复测报告"
    props.subject = "2026-10-17 生产链路、统一 AI 入口与 ContractBundle 复测证据"
    props.author = "MedTrust 生产验证小组"
    props.keywords = "RWD, 单臂试验, 外部对照, MDOP, TDX, 连接器, 销毁, 审计"
    props.comments = f"成功作业 {JOB}；终态 PURGED；bundle {BUNDLE['id']}；数据为合成数据。"
    props.category = "生产验证报告"
    doc.save(OUTPUT)
    print(f"saved {OUTPUT} {OUTPUT.stat().st_size}")


if __name__ == "__main__":
    main()
