
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from report_helpers import *  # noqa
import report_helpers as H
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

SHOTS = ROOT / "screenshots"
OUTPUT = ROOT / "RWD单臂外部对照生产链路复测报告（第三轮）.docx"

JOB = "job-mvci2sti-327ef1fb"


def cover(doc: Document):
    H.add_paragraph(doc, "生产验证报告 · 第三轮", size=10, color=H.TEAL, bold=True, space_before=18, space_after=54)
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run("RWD 单臂外部对照生产链路复测报告")
    H.set_run_font(run, H.FONT_CN, 30, "000000", True)
    H.add_paragraph(
        doc,
        "从零授权开始的完整治理链复测：授权 → 合规预审 → 双院合约 → TDX 证明策略 → 作业提交",
        size=13.5, color="000000", space_after=26, line_spacing=1.3,
    )
    H.add_paragraph(
        doc,
        "本轮在 2026-10-17 于生产环境（web.szchada.top / api.szchada.top）重新执行单臂试验外部对照场景。"
        "为避免旧会话影响判据，测试先从撤销两份产品级 ACL 开始，再逐道闸门重建。"
        "数据为合成数据，结果用于验证平台流程与治理控制，不构成疗效或安全性结论。",
        size=11, space_after=20, line_spacing=1.35,
    )
    H.add_metadata_table(doc, [
        ("生产入口", "https://web.szchada.top"),
        ("控制面 API", "https://api.szchada.top/api/v1"),
        ("作业标识", JOB),
        ("作业终态（本轮）", "SUBMITTED（编译阶段被控制面拒绝，见第 8 章）"),
        ("测试日期", "2026-10-17（CST 22:00–23:00）"),
        ("报告版本", "V1.0"),
    ])
    H.add_paragraph(doc, "编制：MedTrust 生产验证小组", size=9.5, color=H.MUTED, space_before=22, space_after=2)


def summary(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "执行结论", 1)
    H.add_paragraph(
        doc,
        "本轮复测从「无任何产品访问授权」的干净状态开始，逐道重建治理链。结论分两部分："
        "治理与授权链在本轮完整走通并可逐项复核；作业执行链在本轮未走通——作业提交后，"
        "控制面在编译阶段返回 400 E_RUNTIME（算子运行时错误），因此没有产生片段、执行凭证、"
        "匹配结果与销毁回执。报告如实记录这一断点，不做「链路已跑通」的表述。",
    )
    H.add_heading(doc, "核心结果", 2)
    H.add_data_table(
        doc,
        ["检查项", "本轮实际结果", "判断"],
        [
            ["授权闸门复现", "撤销两份 ACL 后，AI 助手拒发配置并逐条给出授权缺失原因", "通过"],
            ["产品级 ACL 重建", "两份 ACL 生效，check 返回 allowed=true（图 5）", "通过"],
            ["L2 合规裁决", "auto_approve，medium，要求 federated + partial_or_above + k=5", "通过"],
            ["数字合约", "两份生效（p-huashan / p-ruijin），用途 drug-registration", "通过"],
            ["C2 证明策略", "attestation_policy={tee:[tdx], min_tcb:{tdx:5.1.3}}，allowed_ops 两项", "通过"],
            ["院内本地确认", "两院连接器本地确认并用本院私钥签署，平台副署后 mdopStatus=active", "通过"],
            ["作业提交", "POST /mdop/jobs/external-control 返回 " + JOB + "（6 阶段）", "通过"],
            ["作业编译", "POST /mdop/jobs/" + JOB + "/compile → 400 E_RUNTIME", "失败"],
            ["执行 / 结果 / 销毁", "未发生（无片段、无凭证、无结果、无销毁回执）", "未执行"],
        ],
        widths=[1.45, 4.35, 0.85],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
    )
    H.add_heading(doc, "结论边界", 2)
    H.add_bullet(doc, "本轮能证明的是：授权、合规、合约、证明策略、院内确认这五道治理闸门可以按设计顺序协同工作，缺少任何一道时后续步骤都被前置挡住。")
    H.add_bullet(doc, "本轮不能证明的是：作业在可信空间节点内的匹配、发布审查与销毁。编译期失败使执行链未启动，因此不涉及任何节点行为。")
    H.add_bullet(doc, "上一轮（同日 21:03 CST）同一链路执行到 PURGED 的记录仍在生产库与生产日志中（作业 job-mvcepxot-0113b188）；本轮不以其结果替代本轮的断点结论。")


def background(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "场景背景与业务价值", 1)
    H.add_heading(doc, "单臂试验为什么需要外部对照", 2)
    H.add_paragraph(
        doc,
        "单臂试验只观察接受试验干预的人群，没有同期内部随机对照。在罕见病、严重疾病或伦理上难以设置"
        "安慰剂组的场景里，研究团队会考虑用其他机构的历史真实世界数据构建外部对照臂。这条路径是否可用，"
        "取决于人群定义、分层匹配、时间零对齐、数据质量与偏倚控制；平台跑通不等于临床证据成立。",
    )
    H.add_paragraph(
        doc,
        "本轮沿用上一轮的合成数据设定：华山试验点 460 例单臂试验受试者数据、瑞金 5,600 例历史对照池。"
        "两方按年龄带 × 性别分层，在节点内按卡尺与 K:1 比例匹配，平台只接收达到最小单元格阈值的聚合结果。",
    )
    H.add_heading(doc, "业务价值", 2)
    H.add_bullet(doc, "药企可以在投入前瞻性对照招募之前，先评估外部对照的样本可得性与匹配规模。")
    H.add_bullet(doc, "医院在本地完成数据准备、合约确认与签名，平台不以业务页面暴露原始行。")
    H.add_bullet(doc, "授权（能不能碰）、合规（能不能做）、合约（以什么条款做）三件事被拆成独立闸门，各由不同角色把关。")
    H.add_bullet(doc, "C2 证明策略把「密文出域」从口头约定变成可核验条款：链型、最低可信基、允许度量都写进签名范围。")
    H.add_heading(doc, "本轮验证目标", 2)
    H.add_data_table(
        doc,
        ["目标", "验证方式", "通过标准"],
        [
            ["授权先行", "先撤销两份 ACL，再从零重建", "无 ACL 时 AI 助手拒绝生成可提交配置"],
            ["合规前置", "创建组合并执行 L2 裁决", "裁决不是 block 才允许申请合约"],
            ["双院签署", "华山、瑞金分别登录并签发", "两份合约生效且引用同一份药企预审"],
            ["证明策略", "运营账号按 TDX 策略发起 MDOP 要约", "条款写入 tee:[tdx] 与最低可信基"],
            ["院内确认", "两院连接器本地确认并签名", "平台副署后 mdopStatus=active"],
            ["受控执行", "提交外部对照作业并编译", "六阶段落库、plan_hash 生成"],
        ],
        widths=[1.1, 2.75, 2.8],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )


def environment(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "生产环境、入口与测试账号", 1)
    H.add_paragraph(
        doc,
        "页面入口为 https://web.szchada.top，控制面 API 为 https://api.szchada.top/api/v1。"
        "本轮所有业务数据由生产 API、生产控制面库与 ali29 上的生产连接器处理，未使用本地隔离测试栈"
        "（/test/ 前缀的隔离栈不接生产连接器，无法完成端到端执行）。",
    )
    H.add_heading(doc, "账号与角色", 2)
    H.add_data_table(
        doc,
        ["角色", "登录账号", "密码", "参与方", "本轮用途"],
        [
            ["药企 PV 研究员", "pv@demo-pharma.example", "demo123456", "pharma-demo", "发起预审、合约与作业"],
            ["华山医院管理员", "admin@huashan-hospital.com", "demo123456", "p-huashan", "签发试验组合约"],
            ["瑞金医院管理员", "admin@rjh.com.cn", "demo123456", "p-ruijin", "签发对照组合约"],
            ["平台合规", "compliance@medtrust.org", "demo123456", "p-compliance", "授予/回收产品级 ACL"],
            ["空间运营", "data-governance@health.gov.cn", "demo123456", "p-health-gov", "按 TDX 策略发起 MDOP 要约"],
        ],
        widths=[1.15, 1.95, 0.85, 1.0, 1.7],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 5,
    )
    H.add_paragraph(doc, "上述均为验证环境演示账号。登录截图按用户要求保留密码明文，未作遮挡。", size=9.5, color=H.MUTED)
    H.add_heading(doc, "关键标识", 2)
    H.add_data_table(
        doc,
        ["对象", "标识"],
        [
            ["试验组数据产品", "40ff788a-89e7-4601-9981-9b9b962d509e（p-huashan · 460 行）"],
            ["对照组数据产品", "99bd8b08-6a69-457f-8063-2bde919ea413（p-ruijin · 5,600 行）"],
            ["试验组 ACL（本轮新建）", "1ded46a6-5a4d-4e74-a5d0-8a9ae644df90"],
            ["对照组 ACL（本轮新建）", "c3e0ec20-795a-4d06-9a2a-42229a7b0e04"],
            ["合规预审组合", "d3d42c10-4fb6-4782-ad8e-172f1d2961cf"],
            ["试验组合约（华山）", "c284af5c-e2ab-48e6-8961-1a034984c5b6"],
            ["对照组合约（瑞金）", "e6e56c1f-7fc1-415a-aa86-b673518ea995"],
            ["作业", JOB],
        ],
        widths=[1.6, 4.9],
        first_col_fill=H.PALE_BLUE,
    )
    H.add_heading(doc, "本轮基础设施处置（必须披露）", 2)
    H.add_bullet(doc, "生产入口故障：测试开始时 https://web.szchada.top 对公网返回 Cloudflare 520。定位到根因是 Cloudflare 以 HTTPS(443) 回源，而源站营销站容器 szchada-web 没有 web 主机的 443 server 块，请求落到 default_server 的 444（空响应）。已在 /opt/sites/szchada.com/nginx/site.conf 追加 origin.szchada.top / web.szchada.top 的 443 vhost（反代到 medtrust-nginx:80 的 web vhost），备份为 site.conf.bak-web443-20261017，nginx -t 通过后 reload，入口恢复 200。")
    H.add_bullet(doc, "测试工作站的浏览器侧访问：由于 Cloudflare 边缘到本工作站的静态资源链路超时（单块 JS 30s 未取完），浏览器经 SSH 隧道 + 本地反向代理访问 ali29 上同一个生产 nginx 的 web vhost（Host: web.szchada.top），受访容器、数据库、连接器与节点均为生产实例；截图不含地址栏，页面与数据均为生产内容。")
    H.add_bullet(doc, "chat-agent CORS：生产 CORS_ORIGIN 仅允许 https://web.szchada.top。为让工作站源能调用生产 chat-agent，临时把该工作站源加入 CORS_ORIGIN（env 备份 medtrust-chat-agent.env.bak-cors5080-20261017），测试结束后恢复。")


def chain(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "链路与控制点", 1)
    H.add_data_table(
        doc,
        ["顺序", "控制点", "平台行为", "未满足时的结果"],
        [
            ["1", "产品级 ACL", "校验 pharma-demo 对试验与对照产品是否有 catalog / compute 权限", "AI 助手不能生成可提交配置"],
            ["2", "合规预审", "创建组合并执行 L2 裁决（场景风险 + 能力 + 隐私参数）", "合约申请没有合规依据"],
            ["3", "数字合约", "药企申请（引用自己的预审），华山与瑞金分别签发", "没有跨院执行授权"],
            ["4", "C2 证明策略", "运营账号按 TDX 策略发起 MDOP 要约，写入签名范围", "节点不能接收 C2，作业无法在 TEE 内执行"],
            ["5", "院内本地确认", "医院连接器本地确认并用本院私钥签署，平台副署", "合约停在本院 pending，片段会被拒"],
            ["6", "作业提交与编译", "控制面校验合约可用性、算子登记与物理计划", "作业停在 SUBMITTED，无片段与凭证"],
            ["7", "执行与发布审查", "节点内匹配 + 小单元格抑制 + 结果回传", "无聚合结果"],
            ["8", "销毁与审计", "清理临时制品，保留三方回执链", "作业不能进入合规终态"],
        ],
        widths=[0.45, 1.25, 2.75, 2.2],
        alignments=[WD_ALIGN_PARAGRAPH.CENTER] + [WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )
    H.add_heading(doc, "后端服务与 Agent 总览", 2)
    H.add_data_table(
        doc,
        ["组件", "主要职责", "本轮关键动作"],
        [
            ["DataAccessService", "产品级 ACL 的授予、核验与回收", "先回收两份旧授权，再新建两份授权并核验 allowed=true"],
            ["ComplianceService", "合规组合与 L2 裁决", "auto_approve，medium risk，要求 federated + k=5"],
            ["ContractService", "合约申请、签发、知悉确认与完整性校验", "生成两份 draft，消费方知悉后双院签发为 active"],
            ["chat-agent / Pi Agent", "自然语言解析、参数卡片、工具调用与前置闸门", "拦截无授权配置；发起两份合约申请；收集外部对照参数"],
            ["MdopContractService", "MDOP 条款、C2 证明策略与要约", "写入 tee:[tdx]、min_tcb、allowed_ops，并落发件箱"],
            ["华山 / 瑞金 connector", "本地确认合约、取数、密封、签名", "本地确认要约并用本院 SM2 私钥签署 ContractAgree"],
            ["MdopController / MdopJobsService", "编译物理计划、切分片段、生成 plan_hash", "编译阶段返回 400 E_RUNTIME（本轮断点）"],
            ["tee-node-a", "TDX 内匹配、C3 汇总与发布审查", "未参与（无片段下发）"],
        ],
        widths=[1.55, 2.35, 2.55],
        alignments=[WD_ALIGN_PARAGRAPH.LEFT] * 3,
    )



STEPS = [
    dict(
        no="01", shot="01-login-pharma.png",
        title="药企研究员登录生产入口",
        caption="图 1  药企研究员登录生产入口（01-login-pharma.png）",
        op="在用户登录页输入账号、图形验证码与密码，点击登录。",
        account="pv@demo-pharma.example / demo123456",
        entry="https://web.szchada.top/login → 账号密码登录",
        service="控制面认证服务（POST /api/v1/auth/login）",
        action="校验账号、口令与一次性图形验证码哈希，绑定参与方 pharma-demo 与角色 consumer，签发控制台会话。",
        result="登录成功进入 pharma-demo 的数据使用方视图；本次验证码为 vA4Y。",
    ),
    dict(
        no="02", shot="02-space-overview-pharma.png",
        title="确认空间总览与当前身份",
        caption="图 2  空间总览确认当前身份与待办（02-space-overview-pharma.png）",
        op="打开工作台，核对空间 sh-med、角色与待处理事项。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="工作台 → 空间总览",
        service="Workbench / Space Overview",
        action="汇总数据产品数、连接器在线数、生效合约、活跃任务与未读通知，并渲染身份与原始数据出域计数。",
        result="身份显示「创新药企 PV 研究员 · 数据使用方」，左下角「原始数据出域 · 0 行」；待办显示 2 条历史合约通知。",
    ),
    dict(
        no="03", shot="03-data-catalog.png",
        title="查看数据产品目录",
        caption="图 3  数据产品目录只登记元数据（03-data-catalog.png）",
        op="进入数据与合约 → 数据产品，浏览目录。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="数据与合约 → 数据产品",
        service="DataProduct Catalog",
        action="返回产品标题、分级、行数、确权状态与「本地路径（不出域 · 仅连接器可见）」元数据。",
        result="目录共 21 个数据产品；页面只暴露元数据，不返回任何数据行。",
    ),
    dict(
        no="04", shot="03b-control-product.png",
        title="定位试验组与对照组两个产品",
        caption="图 4  试验组与对照组产品同屏（03b-control-product.png）",
        op="滚动到两个目标产品条目，核对产品 ID、行数与本地路径。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="数据与合约 → 数据产品（列表尾部）",
        service="DataProduct Catalog",
        action="渲染两个产品的产品 ID、提供方、行数与确权标签。",
        result="试验组 40ff788a…（460 行，p-huashan）、对照组 99bd8b08…（5,600 行，p-ruijin）；两者的本地路径均标注不出域。注意：目录页并不显示 ACL 授权状态，这一点在第 8 章列为问题。",
    ),
    dict(
        no="05", shot="04-chat-acl-blocked.png",
        title="AI 助手拦截无授权的作业配置",
        caption="图 5  授权缺失时 AI 助手拒发配置并给出两层缺口（04-chat-acl-blocked.png）",
        op="进入研究与任务 → AI 助手，输入“我想做单臂试验的外部对照”，等待回复。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="研究与任务 → AI 助手",
        service="chat-agent（POST /chat-agent/api/v1/chat/stream）→ Pi Agent 工具链 check_data_access",
        action="工具在生成参数卡片之前先查两个产品的产品级 ACL，缺失时 fail-closed，不产出可提交配置，并把两层缺口分开说明。",
        result="助手明确返回“两个数据产品的访问授权都已被提供方回收”，附回收原因与三条恢复路径；同时指出合约层也缺（E_CONTRACT_MISSING）。这一步是本轮「授权先行」的通过证据。",
    ),
    dict(
        no="06", shot="05-acl-check.png",
        title="核验两份产品级 ACL 已生效",
        caption="图 6  产品级 ACL 核验结果（05-acl-check.png，生产 API 原样响应）",
        op="由合规账号为 pharma-demo 新建两份产品级 ACL（catalog + compute），随后核验判定接口。",
        account="compliance@medtrust.org / demo123456（授权执行方）",
        entry="生产 API：POST /api/v1/data-access/grants；GET /api/v1/data-access/check",
        service="DataAccessService",
        action="写入独立授权表（不删行、可回收），返回 grantId 与有效期；check 读取授权表给出 allowed/reason。",
        result="两份 ACL 生效：试验组 1ded46a6…、对照组 c3e0ec20…；check 返回 allowed=true、reason=granted、permissions=[catalog, compute]。",
    ),
    dict(
        no="07", shot="06-compliance-evaluation.png",
        title="创建合规预审并执行 L2 裁决",
        caption="图 7  L2 裁决 auto_approve（06-compliance-evaluation.png，生产 API 原样响应）",
        op="药企创建预审组合（场景 multi-center-clinical-research，协议 federated-local-compute，匿名化 complete，k=5，参与机构 2），随后执行裁决。",
        account="pv@demo-pharma.example / demo123456",
        entry="生产 API：POST /api/v1/composition；POST /api/v1/compliance/evaluate/:id",
        service="ComplianceService（L2 规则引擎）",
        action="按场景风险推导要求（federated、partial_or_above、k=5），比对所选能力与隐私参数，记录规则摘要与维度来源。",
        result="autoVerdict=auto_approve，overallRisk=medium，blockingRulesMatched=[]，dimensions.participantCount=2（declared），rulesDigest 以 SM3 固化。",
    ),
    dict(
        no="08", shot="05-contracts-pharma-drafts.png",
        title="药企发起两份数字合约申请",
        caption="图 8  药企侧两份合约处于待审批（05-contracts-pharma-drafts.png）",
        op="在数字合约页发起申请（或由 AI 助手代理发起），引用同一份合规预审，用途 drug-registration，仅聚合统计，minCell=5。",
        account="pv@demo-pharma.example / demo123456",
        entry="数据与合约 → 数字合约（或 AI 助手「同意并提交申请」卡片）",
        service="ContractService",
        action="按产品与提供方拆成两份 draft，生成条款、哈希与待签发记录，并通知对应医院。",
        result="形成 pharma-demo → p-huashan、pharma-demo → p-ruijin 两份 draft；页面显示「待审批」。",
    ),
    dict(
        no="09", shot="06-login-huashan.png",
        title="华山医院管理员登录并查看待办",
        caption="图 9  华山管理员登录后的空间总览（06-login-huashan.png）",
        op="切换到华山管理员账号登录，查看待本院签发数量与通知。",
        account="admin@huashan-hospital.com / demo123456",
        entry="https://web.szchada.top/login → 工作台",
        service="控制面认证服务 + 通知服务",
        action="认证医院管理员并绑定 p-huashan；工作台汇总「待本院签发的合约」与合约申请通知。",
        result="身份显示「华山医院管理员 · 数据提供方」；待本院签发 1 份，通知列表出现药企的合约申请。",
    ),
    dict(
        no="10", shot="07-contract-trial-pending-huashan.png",
        title="华山核对试验组合约条款",
        caption="图 10  华山侧试验组合约待签发（07-contract-trial-pending-huashan.png）",
        op="进入数字合约，定位 pharma-demo → p-huashan 的待审批条目。",
        account="admin@huashan-hospital.com / demo123456（当前会话）",
        entry="数据与合约 → 数字合约（列表尾部）",
        service="ContractService",
        action="按提供方过滤 draft，返回用途、保留期、输出限制与签发/驳回入口。",
        result="条款为「用途 drug-registration · 作业完成后 30 天 · 仅聚合统计 · minCell=5」，可进入签发。",
    ),
    dict(
        no="11", shot="08-contract-trial-active-huashan.png",
        title="华山签发试验组合约",
        caption="图 11  签发后合约生效（08-contract-trial-active-huashan.png）",
        op="点击「签发」。首次点击被拒（消费方尚未确认规则知悉），由药企完成知悉确认后再次签发。",
        account="admin@huashan-hospital.com / demo123456",
        entry="数字合约 → 待本院签发 → 签发",
        service="ContractService + 华山 connector 本地确认",
        action="校验持有方签名、消费方知悉记录与条款哈希，写回 active 并生成链上存证回执。",
        result="试验组合约 c284af5c… 生效；C2 面板提示「当前条款未声明证明策略 —— 该合约不允许任何节点接收 C2」，即下一步必须补证明策略。",
    ),
    dict(
        no="12", shot="09-contract-control-pending-ruijin.png",
        title="瑞金管理员登录并核对对照组合约",
        caption="图 12  瑞金侧对照组合约待签发（09-contract-control-pending-ruijin.png）",
        op="切换到瑞金管理员账号登录，定位 pharma-demo → p-ruijin 的待审批条目。",
        account="admin@rjh.com.cn / demo123456",
        entry="https://web.szchada.top/login → 数据与合约 → 数字合约",
        service="控制面认证服务 + ContractService",
        action="认证 p-ruijin 管理员并按提供方过滤 draft。",
        result="条款与前一份一致（drug-registration / 30 天 / 仅聚合 / minCell=5），可签发。",
    ),
    dict(
        no="13", shot="10-contract-control-active-ruijin.png",
        title="瑞金签发对照组合约",
        caption="图 13  对照组合约生效（10-contract-control-active-ruijin.png）",
        op="点击「签发」，核对生效状态。",
        account="admin@rjh.com.cn / demo123456",
        entry="数字合约 → 待本院签发 → 签发",
        service="ContractService + 瑞金 connector 本地确认",
        action="校验知悉与签名后写回 active，并向药企发送「合约已签发」通知。",
        result="对照组合约 e6e56c1f… 生效；两份合约分别由两家医院持有本地副本。",
    ),
    dict(
        no="14", shot="12b-chat-contract-requested.png",
        title="AI 助手以药企身份推进合约缺口的闭环",
        caption="图 14  助手逐份发起合约申请并等待签发（12b-chat-contract-requested.png）",
        op="在 AI 助手中确认「同意并提交申请」，并回答使用哪一份合规预审。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="研究与任务 → AI 助手",
        service="chat-agent → request_contract 工具 → ContractService",
        action="把预审 id、用途与产品写入申请；每提交一份即回一张结果卡（contractId / status / compositionId），并在两份都提交后停止继续配置。",
        result="助手明确「两份都签发后回来招呼一声」，即它自己也不越过 active 判据；本轮最终用于作业的两份合约即由此生成。",
    ),
    dict(
        no="15", shot="11-mdop-tdx-policy.png",
        title="按 TDX 证明策略发起 MDOP 要约",
        caption="图 15  条款写入证明策略与持有人签名（11-mdop-tdx-policy.png，生产 API 原样响应）",
        op="运营账号对两份合约发起带证明策略的 MDOP 要约：链型 tdx、最低可信基 tdx=5.1.3、允许算子两项。",
        account="data-governance@health.gov.cn / demo123456",
        entry="生产 API：POST /api/v1/contracts/:id/mdop/offer（控制台对应「带证明策略重新发起 MDOP 要约」）",
        service="MdopContractService",
        action="生成条款（含 attestation_policy 与 allowed_ops）、落发件箱、作废旧要约，并由长轮询下发给对应医院连接器。",
        result="条款中 attestation_policy={tee:[tdx], min_tcb:{tdx:5.1.3}}、allowed_ops=[rws.external-control@1.0.0, declassify.small_cell@1.0.0]、holderSignature 已写入；平台副署后 mdopStatus=active。",
    ),
    dict(
        no="16", shot="12-chat-form-card.png",
        title="AI 助手返回外部对照参数卡片",
        caption="图 16  外部对照参数卡（12-chat-form-card.png）",
        op="在 AI 助手中继续配置外部对照参数。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="研究与任务 → AI 助手 → 参数卡片",
        service="chat-agent（scenario=external-control）",
        action="解析意图并生成结构化表单：试验方/对照方、双方数据产品、分层键、卡尺、K:1 比率、最小单元格、用途编码；卡片说明将使用两份带 TDX 证明策略的合约。",
        result="卡片字段与必填项齐全，默认值 ageBand,sex / 0.2 / 1 / 10 / drug-registration 可由用户改。",
    ),
    dict(
        no="17", shot="13-chat-form-filled.png",
        title="填写外部对照参数",
        caption="图 17  参数按本轮设定填写（13-chat-form-filled.png）",
        op="试验方 p-huashan（460 例）、对照方 p-ruijin（5,600 例）；分层键 ageBand,sex；卡尺 30 天；比率 2:1；最小单元格 5；用途 drug-registration。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="AI 助手参数卡片",
        service="chat-agent 表单校验",
        action="校验参与方不相同、分层键非空、数值范围（卡尺 1–365、比率 1–10）。",
        result="参数与授权产品一致，可以提交。",
    ),
    dict(
        no="18", shot="14-chat-submitted.png",
        title="提交外部对照作业（助手侧被拦，改由控制面入口提交）",
        caption="图 18  助手侧两次提交均被自身判据拦下（14-chat-submitted.png）",
        op="点击「提交」。助手先以「试验臂产品归属不是申办方」拦下，再以「minCell=5 低于空间最小单元格门槛」拦下。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="AI 助手 → 提交",
        service="chat-agent → submit_external_control → POST /api/v1/mdop/jobs/external-control",
        action="助手在调用控制面前做合规前置判断；被拦时返回结构化失败卡（status=rejected / blocked，附 error、scenario 与已填参数）。",
        result="平台模板本身只要求「两方非空且不相同」，而助手按「申办方 / 医院」口径判断并拦下；本轮最终以同一 payload 直接调用控制面入口完成提交（job-mvci2sti-327ef1fb，6 阶段）。该口径不一致已列为第 8 章问题 F2。",
    ),
    dict(
        no="19", shot="15-job-detail.png",
        title="控制面作业详情（本轮断点）",
        caption="图 19  作业停在 SUBMITTED，plan_hash 为空（15-job-detail.png）",
        op="打开作业详情页并随后触发编译。",
        account="pv@demo-pharma.example / demo123456（当前会话）",
        entry="研究与任务 → 编排任务 → 作业详情 /space/mdop/jobs/" + JOB,
        service="MdopController / MdopJobsService（编译与片段切分）",
        action="提交写入 status=SUBMITTED、logicalPlan 六阶段；POST /mdop/jobs/:id/compile 触发物理计划构建与片段切分。",
        result="编译返回 400 E_RUNTIME（算子运行时错误），plan_hash 仍为空、片段 0 条、执行凭证未签发，因此匹配、发布审查、销毁均未发生。",
    ),
]


def add_steps(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "端到端生产测试步骤", 1)
    H.add_paragraph(
        doc,
        "以下按实际操作顺序给出 19 个证据步骤。每一步先说明页面/接口动作与责任主体，再说明后台服务或 Agent 的动作与作用，最后给出截图。"
        "截图保持生产环境原始状态，未做合成或拼贴；其中第 6、7、15 步为生产 API 的原样响应渲染（用于展示接口级证据），其余均为控制台页面。",
    )
    for step in STEPS:
        H.add_heading(doc, f"{step['no']}  {step['title']}", 1)
        H.add_paragraph(doc, step["op"], size=10.5, space_after=4)
        H.add_data_table(
            doc,
            ["项目", "内容"],
            [
                ["登录账号 / 密码", step["account"]],
                ["入口", step["entry"]],
                ["后台服务 / Agent", step["service"]],
                ["后台动作", step["action"]],
                ["作用与结果", step["result"]],
            ],
            widths=[1.15, 5.35],
            font_size=8.6,
            first_col_fill=H.PALE_BLUE,
        )
        path = SHOTS / step["shot"]
        if path.exists():
            H.add_figure(doc, path, step["caption"])
        else:
            H.add_paragraph(doc, f"[缺失截图：{step['shot']}]", size=9, color=H.MUTED)



def findings(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "本轮发现与问题", 1)
    H.add_paragraph(
        doc,
        "以下问题均在本轮复测中实际出现并有证据可查。按「是否阻断链路」排序，不按严重度修辞。",
    )
    H.add_data_table(
        doc,
        ["编号", "问题", "证据 / 复现", "影响", "建议"],
        [
            ["F1", "作业编译返回 400 E_RUNTIME（算子运行时错误），无更细的错误码或堆栈",
             "POST /api/v1/mdop/jobs/" + JOB + "/compile；页面与接口均为通用文案，API 日志未打印具体原因",
             "阻断执行、结果与销毁：本轮无法完成端到端",
             "编译期异常应按 MdopError 细分（缺能力 / 度量不符 / 条款不满足）并打印节点与阶段；同时把失败写入作业 rejectReason"],
            ["F2", "AI 助手与平台模板对「试验臂归属」的判据不一致",
             "助手以「试验臂产品归属不是申办方」拦下；平台模板仅校验 trial/controls 非空且不相同（industries/med/src/templates/external-control.ts:56-61）",
             "同一 payload 助手拒绝、控制面接受，用户无法判断该信谁",
             "把口径收敛到一处：或平台增加申办方角色校验，或助手去掉该判断并只做结构性校验"],
            ["F3", "最小单元格默认值不一致：助手 10、合约 5",
             "助手拦下 minCell=5；合约 outputPolicy.minCell=5",
             "低门槛场景被助手误拦，用户被迫放宽输出限制",
             "助手默认值应读取合约或空间策略，而不是硬编码"],
            ["F4", "数据产品目录不显示 ACL 授权状态",
             "图 3 / 图 4 只有「已确权」标签；授权状态只能通过助手或 /data-access/check 查",
             "用户无法在目录页判断「我能不能用」",
             "目录行内增加授权徽标与申请/回收入口，数据源复用 check 接口"],
            ["F5", "合约列表页对每份合约各发一次 /contracts/:id/mdop，触发限流 429",
             "浏览器网络面板：24 份合约 → 24 次并发请求，后段 429；C2 面板因此显示「未声明证明策略」",
             "页面显示与实际条款不一致（证明确实已声明）",
             "改为列表接口一次性返回 attestation_policy 摘要，或按需展开时再查"],
            ["F6", "消费方「规则知悉」是签发前置，但控制台没有该按钮",
             "华山首次点击签发失败：失败: 消费方尚未确认规则知悉",
             "医院与药企在页面上无路可走，只能由接口补",
             "合约行内提供「确认知悉」动作并按角色显示"],
            ["F7", "生产入口 Cloudflare 520（已修复，但缺少部署守护）",
             "CF 以 443 回源，源站没有 web 主机的 443 vhost → 444 → 520",
             "生产入口整体不可用，且只在外部访问时才暴露",
             "把「443 vhost 存在且返回 200」纳入发布后自检；nginx 配置纳入版本管理与 diff 审核"],
            ["F8", "连接器的院内确认与「回传平台」是两段手工动作",
             "本地确认只返回 agreement，需再 POST /contracts/mdop/agree",
             "院内确认后合约可能长期停在 offered，双方都以为已完成",
             "确认后由连接器出站通道自动回传（§7 消息通道），或控制台给出「未回传」显式状态"],
        ],
        widths=[0.45, 1.55, 2.05, 1.25, 1.9],
        font_size=8.0,
        alignments=[WD_ALIGN_PARAGRAPH.CENTER] + [WD_ALIGN_PARAGRAPH.LEFT] * 4,
    )
    H.add_heading(doc, "对「生产可用」的判断", 2)
    H.add_bullet(doc, "治理链（授权 / 合规 / 合约 / 证明策略 / 院内确认）在本轮可重复走通，闸门顺序与 fail-closed 行为符合设计。")
    H.add_bullet(doc, "执行链在本轮不可用：编译期通用错误码把可诊断信息抹掉了，现场无法在不读源码的情况下定位。这一点对生产运维是硬伤。")
    H.add_bullet(doc, "在同一生产环境，同日 21:03 CST 的上一轮曾执行到 PURGED；因此本轮编译失败更像是回归或环境差异，而不是能力缺失。建议以本轮作业为样本做一次编译链路回归，确认是条款形态（allowed_ops / attestation_policy）还是算子能力登记变化导致。")


def final_summary(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "总结", 1)
    H.add_paragraph(
        doc,
        "本轮复测回答了一个具体问题：当一个药企从零开始，想在 MedTrust 上做一次单臂试验的外部对照，"
        "它会被哪些门挡住、这些门是否按设计顺序生效、以及最后一步能不能跑起来。",
    )
    H.add_heading(doc, "已经验证的部分", 2)
    H.add_bullet(doc, "授权门：撤销授权后 AI 助手立刻拒发配置，并区分「授权」与「合约」两层缺口，不给出可提交的假配置。")
    H.add_bullet(doc, "合规门：预审组合通过 L2 裁决（auto_approve / medium / federated / k=5），规则摘要以 SM3 固化。")
    H.add_bullet(doc, "合约门：两份合约分别由华山与瑞金签发，引用药企自己的预审；消费方未确认知悉时医院无法签发。")
    H.add_bullet(doc, "证明策略门：C2 条款把链型、最低可信基与允许算子写进签名范围，医院连接器本地确认后平台才副署。")
    H.add_bullet(doc, "提交门：六阶段逻辑计划落库，作业进入 SUBMITTED。")
    H.add_heading(doc, "没有验证的部分", 2)
    H.add_paragraph(
        doc,
        "作业编译失败（400 E_RUNTIME），因此本轮没有片段、没有执行凭证、没有节点内匹配、没有小单元格抑制后的聚合结果，也没有销毁回执。"
        "凡涉及「数据在节点内如何被处理」「结果是否满足最小单元格」「回执链是否连续」的结论，本轮一概不给。",
    )
    H.add_heading(doc, "建议的下一步", 2)
    H.add_bullet(doc, "优先修 F1：让编译失败可诊断（错误码 + 阶段 + 节点 + 条款），这是生产可运维的底线。")
    H.add_bullet(doc, "统一 F2 / F3：助手与平台必须使用同一份判据与默认值，否则助手会变成「看起来更严」的假闸门。")
    H.add_bullet(doc, "补 F4 / F5 / F6：三个都是页面表达问题，但直接影响用户能否自己走完流程。")
    H.add_bullet(doc, "把 F7 纳入发布自检：出入口可用性用一个外部探测即可覆盖，代价远低于一次对外演示失败。")
    H.add_bullet(doc, "编译修好后，用同一份合约与同一组参数重跑一次，把作业推进到 PURGED，补齐本轮缺失的执行段证据。")


def appendix(doc: Document):
    H.add_page_break(doc)
    H.add_heading(doc, "附录", 1)
    H.add_heading(doc, "证据文件清单", 2)
    H.add_data_table(
        doc,
        ["文件", "内容"],
        [
            ["01-login-pharma.png", "药企登录页，账号/验证码/密码可见"],
            ["02-space-overview-pharma.png", "药企空间总览与身份"],
            ["03-data-catalog.png", "数据产品目录"],
            ["03b-control-product.png", "试验组与对照组产品同屏"],
            ["04-chat-acl-blocked.png", "无授权时 AI 助手拦截"],
            ["05-acl-check.png", "产品级 ACL 核验（生产 API 响应）"],
            ["06-compliance-evaluation.png", "L2 裁决结果（生产 API 响应）"],
            ["05-contracts-pharma-drafts.png", "药企侧两份合约待审批"],
            ["06-login-huashan.png", "华山管理员登录后总览"],
            ["07-contract-trial-pending-huashan.png", "华山待签发"],
            ["08-contract-trial-active-huashan.png", "华山签发生效"],
            ["09-contract-control-pending-ruijin.png", "瑞金待签发"],
            ["10-contract-control-active-ruijin.png", "瑞金签发生效"],
            ["12b-chat-contract-requested.png", "助手发起合约申请的结果卡"],
            ["11-mdop-tdx-policy.png", "MDOP 条款与 TDX 证明策略（生产 API 响应）"],
            ["12-chat-form-card.png", "外部对照参数卡"],
            ["13-chat-form-filled.png", "参数填写完成"],
            ["14-chat-submitted.png", "助手侧提交被拦的结构化回执"],
            ["15-job-detail.png", "作业详情（SUBMITTED，plan_hash 为空）"],
        ],
        widths=[2.55, 3.95],
        font_size=8.4,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )
    H.add_heading(doc, "关键接口（复现用）", 2)
    H.add_data_table(
        doc,
        ["动作", "方法与路径"],
        [
            ["登录（图形验证码）", "POST /api/v1/auth/login  {account, password, captchaId, captchaCode}"],
            ["查授权判定", "GET /api/v1/data-access/check?participantId=&dataProductId="],
            ["新建授权", "POST /api/v1/data-access/grants  {dataProductId, granteeParticipantId, permissions}"],
            ["回收授权", "POST /api/v1/data-access/grants/:id/revoke  {reason}"],
            ["创建预审组合", "POST /api/v1/composition  {scenarioKey, protocolKeys, chosenParams, riskDimensions}"],
            ["执行 L2 裁决", "POST /api/v1/compliance/evaluate/:compositionId"],
            ["申请合约", "POST /api/v1/contracts/requests  {dataProductId, compositionId, purpose, retention, output, minCell, validDays}"],
            ["消费方知悉", "POST /api/v1/contracts/:id/acknowledge"],
            ["医院签发", "POST /api/v1/contracts/:id/approve"],
            ["TDX 要约", "POST /api/v1/contracts/:id/mdop/offer  {attestationPolicy:{tee:[tdx],minTcb:{tdx:5.1.3}}, allowedOpDigests:[…]}"],
            ["院内确认", "POST http://<connector>:5022/connector/mdop/contracts/pending/:offerId/confirm（x-connector-admin-token）"],
            ["平台副署", "POST /api/v1/contracts/mdop/agree  {contractId, canonical, holderSignature}"],
            ["提交作业", "POST /api/v1/mdop/jobs/external-control（trial / controls / teeNode / strataKeys / caliperDays / ratioK / minCell）"],
            ["编译作业", "POST /api/v1/mdop/jobs/:id/compile"],
            ["作业详情", "GET /api/v1/mdop/jobs/:id"],
        ],
        widths=[1.45, 5.05],
        font_size=8.2,
        alignments=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )
    H.add_heading(doc, "说明", 2)
    H.add_paragraph(
        doc,
        "本报告中的截图来自 2026-10-17 的生产会话（CST 22:00–23:00）。截图不含浏览器地址栏；"
        "页面是通过 SSH 隧道访问生产 nginx 的 web vhost 获得的，受访容器、数据库、连接器与节点均为生产实例，"
        "原因见第 3 章「本轮基础设施处置」。所有账号均为验证环境演示账号。",
        size=9.5, color=H.MUTED,
    )


def main():
    doc = Document()
    H.style_document(doc)
    cover(doc)
    summary(doc)
    background(doc)
    environment(doc)
    chain(doc)
    add_steps(doc)
    findings(doc)
    final_summary(doc)
    appendix(doc)
    cp = doc.core_properties
    cp.title = "RWD 单臂外部对照生产链路复测报告（第三轮）"
    cp.subject = "生产入口 web.szchada.top 的治理链复测与作业编译断点记录"
    cp.author = "MedTrust 生产验证小组"
    cp.keywords = "RWD, 单臂试验, 外部对照, ACL, 合规预审, 数字合约, MDOP, TDX"
    cp.comments = "2026-10-17 生产复测；作业 job-mvci2sti-327ef1fb"
    cp.category = "生产验证报告"
    doc.save(OUTPUT)
    print("saved", OUTPUT, OUTPUT.stat().st_size)


if __name__ == "__main__":
    main()
