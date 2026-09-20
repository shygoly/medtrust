## Context

Wasm 沙箱能力（D-CN-2）已部署 ali29：模块入 api 镜像、注册表按 SM3（`b2760b0c…`）装载并用当前 CA（`046eb66d`）动态签名、沙箱在加固连接器容器内验证可运行（`envVars=0`）。但线上从未有真实任务走过沙箱——缺固定模块合约 + 连接器缺 disproportionality 演示数据（AMR 产品 `localDataPath` 指向未烘焙路径，任务失败于取数）。本变更把「已部署」推到「在用」。

已知事实（本会话核实）：连接器只烘焙 `data/rws-injected`（非 git，含胰岛素队列 5000 条，字段有 `medications`/`adverseEvents` 但 AE 稀疏）；AMR 数据集 `data/synthetic/amr/connectors/<site>` 未 git-tracked、未烘焙、由 `scripts/amr/` 生成；`digital-contract` 已支持 `pinnedModules` 且生成时校验 SM3 在册；compliance 预审网关不拦 disproportionality（本会话提交已过闸，仅失败于取数）。

## Goals / Non-Goals

**Goals:**
- 线上产出 `executionIsolation=wasm-sandbox`（最小闭环，阶段 1），关闭 `connector-wasm-sandbox-disproportionality` 的 7.1 待补。
- 供给真实 disproportionality 数据集，出非平凡失衡信号（阶段 2）。

**Non-Goals:**
- 不改沙箱执行/签名/校验语义（`algorithm-sandbox` 已归档，语义冻结）。
- 不引入第三方模块准入（那是 `third-party-wasm-module-admission`）。
- 不追求 AMR 的科学效度（信号仅作演示，效度归 EVIDENCE）。

## Decisions

### D1. 两阶段：先证路径（已烘焙数据），再出信号（AMR 数据）
阶段 1 用**已烘焙**的 `rws-injected` 胰岛素产品——零数据供给即可跑通，最快拿到 `executionIsolation=wasm-sandbox`。阶段 2 再供给 AMR 数据出有意义信号。
- 备选：直接上 AMR（跳过阶段 1）。**否决**：AMR 数据未烘焙需重建连接器镜像，把「证明路径」这件最有价值、最快的事压在数据供给之后；分阶段让 7.1 待补尽早关闭。

### D2. 固定模块合约用「种子」而非 request→approve 流
经 `ContractService.approve` 种一份带 `pinnedModules` 的合约（**哈希经 canonical 正确计算**、SM3 在册校验复用现成逻辑）。
- 备选：走消费方 request → 医院 approve 全流程。**否决**：更重（预审绑定等），对「演示一次固定模块任务」无额外价值；种子确定、可复现。
- 反例守护：**禁止**直接 DB 写 `pinnedModules`（会破坏合约哈希完整性）。

### D3. 阶段 2 数据供给 = 随连接器镜像烘焙（对齐 rws-injected）
AMR 数据集按 `SYNTHEA_CONNECTOR` 选院烘焙进 `Dockerfile.connector`，落到产品 `localDataPath`，与现有 `rws-injected` 同法（非 git 数据入镜像）。
- 备选：挂卷。**次选**：多一处运维状态；烘焙与既有模式一致、镜像自包含。
- 数据来源：`scripts/amr/` 可复现生成；构建前预生成或纳入构建。

### D4. 阶段 1 信号平凡是可接受的
胰岛素队列 AE 稀疏，disproportionality 可能 `k` 很小甚至为 0；但**模块仍执行、仍回 cohortSize、仍记 `executionIsolation=wasm-sandbox`**——路径为真即达标。若 `k=0` 让验收不直观，可给阶段 1 队列注入少量 AE 词条（仅演示）。

## Risks / Trade-offs

- **阶段 1 `k=0`（无 AE 词条）致验收不直观** → 接受（路径仍证）或给队列注入少量 AE 词条；`executionIsolation=wasm-sandbox` 与 `k` 无关。
- **种子合约哈希破坏** → 只经 `ContractService.approve` 生成，绝不 DB 直写 `pinnedModules`。
- **阶段 2 需重建连接器镜像** → 带 `-f compose.hardening.yaml`（否则加固丢失）；CA 已挂卷持久化，重建 api 不再重生（本会话已解决）。
- **AMR 数据可复现性** → 生成脚本锁输入；两院数据按 `SYNTHEA_CONNECTOR` 分别烘焙。

## Migration Plan

- **阶段 1（无重建）**：种固定模块合约（insulin 产品）→ 提交 disproportionality 任务（drug=insulin，带 designType/rationale/sap）→ 验 `executionIsolation=wasm-sandbox`；对照无固定模块合约 → `none`。达成即关 7.1 待补、架构图 Wasm 改「在用」。
- **阶段 2（重建连接器）**：生成 AMR 数据 → 烘焙进连接器镜像 → 重建（hardening overlay）→ 种 AMR 固定模块合约 → 跑任务出非平凡信号。
- **回滚**：固定模块合约是增量；撤下它/用无固定模块合约即回 TS 路径，连接器/沙箱不受影响。

## Open Questions

- 阶段 1 用哪个**已有数据产品 + 消费方 + 目的**种固定模块合约（复用 insulin 产品与某演示消费方，purpose 与合约一致）？
- 阶段 1 胰岛素队列**是否已有任何 AE 词条**（决定 `k` 是否 >0，是否需注入演示 AE）？
- 阶段 2 AMR 生成数据**是否入 git**（现未 tracked）还是构建时生成？
- 前端任务详情对 disproportionality + wasm-sandbox 的显示是否已就绪（`connector-wasm-sandbox-disproportionality` 6.1 已做执行隔离显示，需核对 disproportionality 任务视图）。
