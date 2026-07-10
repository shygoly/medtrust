## Context

现有联邦 RWS 只做 L1 描述统计:连接器在 TEE 内对脱敏行做计数/患病率/AE 频次,输出闸门做小单元格抑制后只放行 `{count, rate}` 聚合(`apps/connector` 的 `rws-executor` / `output-gate` / `connector-task-runner`)。控制面(`apps/api/runtime/rws-orchestrator`)负责合约校验与下发。多轮联邦训练轨道已独立存在(`apps/agent` 的 FedAvg/LoRA + `HeSecureAggregator` + DP-SGD;`secretflow-orchestrator` 的 FSM/gRPC/WS)。

不变约束:**原始行不出域,只有过闸聚合可流出,全程上链**。本设计在此约束下把分析提升为 L1.5→L4 阶梯。

## Goals / Non-Goals

**Goals:**
- 用**两种联邦模式**统一四个层级:模式 A(本地全量 + 中心随机效应 meta,单发)、模式 B(迭代联邦拟合,多轮)。
- 新增中心侧 `MetaAnalysisService`;连接器只出站点级充分统计量。
- 输出闸门覆盖高阶产物(效应量/生存尾部/模型参数)的抑制与差分隐私。
- 最大化复用:模式 A 复用现有单发 RWS 通道;模式 B 复用现有 FL 轨道。

**Non-Goals:**
- 不做纵向联邦(VFL,跨机构不同特征列);首版只做水平联邦(HFL)。
- 不改 L1 现有行为(纯增量)。
- 不自建多轮编排(复用 SecretFlow FSM)。

## Decisions

**D1 — L2/L3 默认走模式 A(本地全量 + 中心 meta),而非迭代联邦回归。**
每站在 TEE 内跑完整分析(含站内 PSM、局部 Cox),只吐站点级效应量 + 标准误,中心做随机效应 meta。单发、复用现有通道与闸门、**回避跨站个体匹配**,是 OHDSI/Sentinel/DataSHIELD 主流范式。*Alt:* 全走模式 B(GLORE/WebDISCO 迭代拟合单一 pooled 模型)——保真更高但需多轮、隐私面更大、实现更重;仅在"需单一 pooled 模型"或"站点样本过小需借力"时启用。

**D2 — `MetaAnalysisService` 落中心控制面(`runtime/rws-orchestrator`),不落连接器。**
meta 是跨站聚合,输入为过闸后的站点效应量,天然中心侧且不碰个体行。*Alt:* 指定某"协调者"连接器聚合——抬高连接器信任假设,违背中心编排模型。

**D3 — 统计实现分层:轻量估计量手写 + TDD;数值敏感估计量落 Python agent。**
L1.5(PRR/ROR/IC)、L2(Mantel-Haenszel)、meta(DerSimonian-Laird 随机效应)公式封闭、可黄金用例对拍,TS 手写最快可控。局部 Cox 偏似然、PSM/IPTW 数值敏感且 TS 统计生态弱 → 放 `apps/agent`(现成数值栈)执行,连接器经**本地 in-TEE gRPC**(复用 secretflow 通路)取回站点效应量,数据不出 TEE。*Alt:* 引入 R/DataSHIELD 栈(重、跨语言运维)/ 全手写 Cox(数值风险高)。

**D4 — 模式 B 与 L4 复用既有 FL 轨道,不新建。**
SecretFlow FSM + agent FedAvg/SecureBoost + `HeSecureAggregator` + DP-SGD 已验证;L4 是端到端收尾接线,pooled-L3 亦复用该轨道。

**D5 — 隐私参数上升为合约/任务可声明项,闸门 fail-closed 强制。**
每层不同风险:k 阈值(小分层抑制)、ε 预算(模型产物 DP)、KM 分箱宽度/最小在险数,由数字合约 `allowedArtifacts` + 任务 spec 声明,PEP 授权 + 输出闸门双重强制。

**实现纪律(writing-plans 切片预告,实际标注落 `tasks.md`):**
`MetaAnalysisService`、L3 估计量(Cox/PSM/KM)、输出闸门统计抑制、L2(M-H+logistic)——**均为新算法/安全关键,走 writing-plans(brainstorm→plan→TDD→评审)**;analysis 枚举/DTO 白名单/路由接线/L4 集成接线——直改,`openspec-apply-change` 按 tasks 推进。

## Risks / Trade-offs

- 手写统计数值出错 → 严格 TDD + 与 R/`statsmodels` 参考实现对拍黄金用例(writing-plans 切片)。
- meta 在站点少/异质性高时不稳 → 默认随机效应、报 I²/τ²、单站不合并。
- 高阶产物仍可能泄露(效应量/生存尾部/梯度)→ 分层抑制 + KM 分箱 + DP,闸门 fail-closed(writing-plans 切片)。
- Cox/PSM 落 agent 抬高连接器→agent 本地面 → 复用 in-TEE gRPC,数据留 TEE 内。
- "跨站个体匹配"诱惑 → spec 明令站内匹配 + meta,设计上禁止跨站个体交换。

## Migration Plan

纯增量,L1 不动。按层灰度、每层独立可发:**L1.5 → L2 → L3 → L4**。每层由 analysis type + 合约授权开关控制;回滚 = 合约不授权该层 / 关闭该 analysis type。无数据迁移。

## Open Questions

- **OQ1(已定 2026-07)**:Cox/PSM 落 **Python agent**(数值栈现成)。待落地项 = 坐实连接器→agent 本地 in-TEE gRPC 调用通路(复用 secretflow 通路,数据留 TEE)。此决定与 D3 一致。
- **OQ2**:手写 vs 引库的边界(尤其 Cox/PSM 的库选型)。
- **OQ3(外部阻塞)**:"信号检测 vs 队列疗效"优先级——排序**已定(2026-07):L1.5 信号检测优先**(基础契约后即做,不依赖 `MetaAnalysisService`)。仅剩 (b)——L1.5 具体失衡指标(PRR/ROR/IC/BCPNN)、信号阈值、PSUR/PBRER 对齐——仍需药物警戒岗访谈,但只在建 L1.5(任务 2.2)时用,不卡当前推进。
- **OQ4**:是否需要 VFL(纵向联邦,跨机构不同特征列)——当前 Non-Goal,留待后续。
