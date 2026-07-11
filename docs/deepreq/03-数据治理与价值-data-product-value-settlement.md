# 深度需求 · 03 数据治理与价值层

> 日期: 2026-06-29 · 框架: zai-deepreq 9 维 · 覆盖域: `data-product`(目录) / `value-settlement`(按贡献分账)
> 层定位: 数据空间的**资源刻面与价值闭环**——对外是数据产品(非裸数据集),贡献可计量、按贡献分账、清算上链。
> 锚点: NDI-TR-2025-06(数据目录描述)、"数据二十条"三权分置 + 按贡献决定报酬、联邦学习贡献度(Shapley/CI);并对齐 Fly 现实(分账真实记账、清算上链 mock)。相邻域 `space-interconnect` 在 dim7/决策点引用。

---

## A. data-product(数据产品 — 一等概念,非裸数据集)

### A1 对象与数据来源
- **对象**: 连接器对外提供的**数据产品**(含元数据 / 质量 / 用法 / 分级),而非裸数据集(对齐 TC609-6-2025-01 把数据产品列为连接器最小功能)。RWS 输出也按数据产品管理。
- **数据来源**: 连接器侧确权+分级后发布元数据到控制面目录;**目录元数据不含任何原始行**(已测 `catalog metadata carries no raw rows`)。

### A2 触发
| 模式 | 条件 | 落点 |
|---|---|---|
| 发布 | provider 发布**已确权 + 已分级**的数据产品 | `CatalogService.publish`(拒未确权/未分级,已测) |
| 全局标识 | 发布即分配全局 URN + homeSpace | 已测 9.1 `urn:tds:<space>:<product>` |
| 下架/更新 | 元数据变更/质量降级 | ⚠️ 待补 |
| 目录联邦 | 向行业功能节点推/拉元数据(只读) | 📐 space-interconnect 9.3 |

### A3 执行 / 下发
- 发布 → 校验确权+分级 → 赋 URN → 入控制面目录。跨空间:目录联邦只读发现远端产品元数据(`FederationService` 9.3 discovers remote catalog)。

### A4 回收 / 记录
- 目录项 = 元数据 + 质量指标 + 用法约束;无原始数据。发布/变更进审计。

### A5 状态机
- `draft → confirmed → classified → published → (deprecated | revoked)`。**未确权或未分级不可发布**(硬门,已测)。

### A6 统计
- 在架产品数、按 homeSpace/分级/领域分组、被签约次数、产品被检索/被任务命中次数(URN 路由)。

### A7 边界 / 异常
1. **未确权/未分级发布**: 拒(已测两条)。
2. **元数据泄露**: 目录只存元数据,不含原始行(已测);质量统计若过细可能泄露 → 决策点 D-DP-1(目录元数据粒度上限)。
3. **URN 冲突/跨空间寻址**: URN = `urn:tds:<space>:<product>`,跨空间由 `space-interconnect` 按 URN 路由到产品 homeSpace 连接器(9.5);信任清单外的空间证书被拒(9.2)。
4. **目录管理服务缺口**: 实体已建,目录服务/接口(NDI-TR-2025-06)未全实现(design ⚠️)→ D-DP-2。

### A8 权限 / 审计
- 发布 = `provider`;检索 = 各角色按数据范围;复用 RBAC + 审计。

### A9 数据模型
- `DataProduct`/`DatasetMetadata`(control-plane):`urn / homeSpace / providerId / classification(分级) / quality / usageConstraints / status`;**柔性字段** quality+usage 宜 jsonb。无原始行。

---

## B. value-settlement(价值结算 — 按贡献分账)

### B1 对象与数据来源
- **对象**: 一次已完成计算任务的费用清算 + 各 provider 按贡献的收益分配。
- **数据来源**: 贡献度由 **orchestrator 客观计量**(`perNode.cohortSize` / agent 产出的 `contributions`),**禁止使用方单方声明**(公平性前提,D12)。

### B2 触发
- 任务终态(`result` frame)→ `orchestrate()` 的 `onComplete` → `settleCompletedTask()`。事件驱动,非手动。

### B3 执行 / 清算
- `AttestationService.anchor(reportHash)` 上链(**Fly 上为 mock receipt**,见 B7)+ `SettlementService.record(...)` 写 contribution-weighted 台账(providers only)。预算 `TaskBudget`(默认 100 CNY,POST `budget`)。
- 第一版**不接真实支付**,只记台账(design 最小落地)。

### B4 回收 / 记录
- 台账 `SettlementRecord{lines[]}`,每 line = `{partyId, role, contributionShare, amount}`;consumer 记 charge,provider 记 earning。

### B5 状态机
- `pending → settled`;旁路 `disputed`(贡献争议)→ 决策点 D-VS-2。区分**任务级清算**与**周期对账/提现**(后者未实现)。

### B6 统计(分账公式 — 贡献度计量)
- **现状(已实现)**: 按归一化贡献占比分账,drop-penalized:
  `share_i = contribution_i / Σ contribution_j`,`amount_i = budget × share_i`;掉线 party 贡献惩罚后归一。demo 中 2 院 = 50/50。
- **贡献度计量备选(行业惯例)**:
  - 当前代理量 `cohortSize`(样本量代理)——简单、客观、抗刷。
  - **Shapley value**: `φ_i = Σ_{S⊆N\{i}} [|S|!(|N|−|S|−1)!/|N|!]·[v(S∪{i})−v(S)]`,公平但 O(2^N)/重训代价高;可用 GTG-Shapley(梯度近似+引导采样)降本。
  - **Contribution Index (CI)**: 用局部梯度估贡献,免逐模型重训。
  - **决策点 D-VS-1(★)**: 贡献度口径 = `cohortSize` 代理 vs Shapley/CI(影响公平性诉求与算力成本)。
- 统计维度: 按 provider 累计收益、按 consumer 累计支出、按数据产品/任务、分账基尼系数(公平性观测)。

### B7 边界 / 异常
1. **清算上链**(同 01-A7-3、01-B7-2,勘误): `anchor` 现经长安链 ChainMaker sidecar 真实写入,分账台账上链可追溯成立。残留 = 出域后异步上链的最终一致窗口(D-UC-2)+ sidecar 密钥治理/单节点(D-RWS-3-a/b),见 [04](04-技术选型-架构级决策点.md)。
2. **贡献争议**: provider 质疑分账 → 复核机制?(D-VS-2)
3. **掉线 party 分账**: 已 drop-penalized;是否给部分贡献仍计费?(并入 D-VS-1)
4. **预算耗尽/超支**: budget 用尽拒新任务(01-A7-8);单任务超预算处理?
5. **退款/任务失败**: FAILED 任务不分账;部分完成(COMPENSATED)如何计费 → D-VS-2。
6. **真实支付缺口**: 仅台账,无支付/发票/提现 → D-VS-3。

### B8 权限 / 审计(按角色控权,已测 10.5)
- `operator` 见全量台账;`provider` 仅见自身 earning line;`consumer` 仅见自身 charge;无关 provider 见空。每次 record + anchor 进审计。

### B9 数据模型
- `SettlementRecord`(control-plane):`taskId / budget / lines[]`;line = `{partyId, role, contributionShare, amount, currency}`。`pricing` 来自 `DigitalContract`(按任务/按记录/订阅,见 01-B9)。`contributionShare` 来源字段须记口径(cohortSize / shapley)以备审计。

---

## 本文新增待决策点

| # | 决策点 | 影响 | ★架构 |
|---|---|---|---|
| D-DP-1 | 目录元数据/质量统计的粒度上限(防经元数据再标识) | 目录 schema、隐私 | |
| D-DP-2 | 目录管理服务对齐 NDI-TR-2025-06 的范围(发现/订阅/版本) | 互联互通、目录服务 | |
| D-VS-1 | 贡献度计量口径:`cohortSize` 代理 vs Shapley/CI(公平性 vs 算力成本) | 分账公平性、计算成本、台账 schema | ★ |
| D-VS-2 | 分账争议复核 + 部分完成(COMPENSATED)计费规则 | 结算流程、信任 | |
| D-VS-3 | 是否接真实支付/发票/提现(第一版仅台账) | 商业闭环、合规财务 | |

## 调研来源
- 国标/政策: NDI-TR-2025-06《数据目录描述规范》、TC609-6-2025-01(数据产品为连接器最小功能)、"数据二十条"三权分置与按贡献决定报酬(见 design.md)
- 贡献度计量(Shapley/GTG-Shapley/CI): [联邦学习 Shapley Value 分享](https://zhuanlan.zhihu.com/p/243405494) · [GTG-Shapley 总结](https://blog.csdn.net/qq_42257416/article/details/123148866) · [FL 贡献度测量笔记](https://blog.csdn.net/wuxusanren/article/details/128725110)
- Fly.io 现实(分账真实记账 contribution-weighted、清算上链 mock、demo 50/50): 本仓库部署记忆
