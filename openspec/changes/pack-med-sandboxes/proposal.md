# 提案：医疗包接管节点侧沙箱执行（TD-12 第三刀）

## Why

- 第二刀把平台侧聚合收集器交给了行业包（棘轮 246 → 205）。剩余最大的一簇是**节点侧**：
  `apps/connector/src/mdop/node/{pairing,scri,ve-tnd,dedup-incidence}-sandbox.ts` 共 **24 处**行业词，
  由基座文件 `apps/connector/src/tee-node/wasm-runner.ts`（688 行）静态引用。
- **但它不是机械搬运**（2026-10-14 勘察）：每个 sandbox 导出的是「编码/下限/解码/载荷」四件套，
  runner 里对应四段**按分析类型的执行分支**（约 250 行）与各自的投影/聚合类型深度耦合；
  而且 `wasm-runner.ts` 的文件级注释写明：**三条与出域有关的规矩就钉在这一处唯一入口**
  （错误文案不带数据 / 编码白名单参数校验 / 分层键闭合语法校验）。
  若把这些块「顺手搬走」，等于把 egress 判据从唯一入口挪进行业包——那是**安全回归**，不是重构。
- 所以本变更的目标是：**分析逻辑进包，出域判据留在基座**，并用 connector 全量 + 出域用例 + 棘轮三重闸验收。

## What Changes

1. **SPI**：S2 再增**可选** `declareSandboxes?(ctx)`（`StageSandbox` 接口），与 `declareCollectors` 并列；
   仍**不新开第七根缝**。
2. **基座（connector）**：把「出域判据」抽成**宿主适配器**（`SandboxHost`：算子白名单 / `op_digest` 核对 /
   模块字节取用 / 错误文案脱敏 / 编码白名单校验 / 分层键校验），`wasm-runner.ts` 退化为**薄分派器**：
   按分析类型解析 sandbox → 交宿主适配器执行 → 收窄后的结果。
3. **行业包**：4 个 sandbox 文件与它们的投影/解码逻辑搬进 `industries/med/src/sandboxes/`，
   以 `StageSandbox.runStage(stage, host)` 形态实现；包导出 `medSandboxes()` / `registerMedSandboxes`。
4. **组装根**：`apps/connector/src/app.module.ts` 注册；连接器 jest `setupFiles` 做同一注册。
5. **验收（三重闸）**：connector 全量（现状 136 套件 / 909 用例）全绿；
   **出域用例**（错误文案脱敏 / 编码白名单 / 分层键）逐条保留并有负例；棘轮 **205 → ≤181**。

## 本期不做

- `apps/api/src/mdop/plan-templates.ts`(49) + `mdop.controller.ts`(16)：医疗计划模板，需要**模板注册**缝，
  且模板依赖的 DTO（`fl-prediction-task-spec.ts` 等）本身也是行业件，级联更大，另立一刀。
- wasm 算子登记：`declareOperators()` 仍为空集（等摘要取自复现构建清单）。

## Capabilities

- `kernel-spi`：S2 增 `declareSandboxes`；出域判据 MUST 留在基座（MUST NOT 随分析逻辑进包）。
- `node-execution`：节点侧 wasm 分派经注册表解析；未知类型 fail-closed；出域判据与实现分离。

## Impact

- **代码**：SPI、`industries/med`、`apps/connector`（runner、注册表、组装根、jest 装配、package.json）。
- **风险**：这是**节点在执行解封明文时唯一入口**的重构。缓解：出域判据不搬（由宿主适配器承担），
  并为三条规矩各保留**负例**用例；任何一条被弱化即阻断。
- **证据**：搬移前后同一夹具的阶段输出相等；棘轮计数下降。
