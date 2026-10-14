## 1. SPI 缝

- [ ] 1.1 `packages/space-kernel-spi`：新增 `StageSandbox` 与 `SandboxHost`（执行原语 + 判据）接口；`OperatorPack` 增可选 `declareSandboxes?(ctx)`。
- [ ] 1.2 构建 SPI；确认仍无行业词（目标布局计数不变）。

## 2. 基座：宿主适配器 + 薄分派

- [ ] 2.1 抽 `SandboxHost` 实现：算子白名单 / `op_digest` 核对 / 模块字节取用 / 错误脱敏 / 编码白名单 / 分层键校验（**判据全在这里**）。
- [ ] 2.2 `apps/connector/src/tee-node/sandbox-registry.ts`：域中立注册表（`resolve` / `resolveOrThrow`）。
- [ ] 2.3 `wasm-runner.ts` 退化为薄分派：按类型解析 sandbox → `runStage(stage, host)`；删除四段分析分支与静态 import。
- [ ] 2.4 三条出域判据的**负例**用例逐条保留（错误文案 / 编码白名单 / 分层键）。

## 3. 行业包：搬实现 + 注册

- [ ] 3.1 4 个 sandbox 与其投影/解码逻辑搬进 `industries/med/src/sandboxes/`（同函数体，仅适配 `runStage` 入口）。
- [ ] 3.2 包导出 `medSandboxes()` / `registerMedSandboxes(registry)`；`medOperators.declareSandboxes` 声明之。

## 4. 组装根与装配

- [ ] 4.1 `apps/connector/src/app.module.ts` 注册；`apps/connector` 加 `@medtrust/domain-med` 依赖（如需）。
- [ ] 4.2 连接器 jest `setupFiles` 做同一注册。

## 5. 三重闸验收

- [ ] 5.1 connector 全量（136 套件 / 909 用例）全绿。
- [ ] 5.2 三条出域负例 + 搬移前后同夹具输出相等（写入 evidence）。
- [ ] 5.3 棘轮基线重生成：**205 → ≤181**；`pnpm test` 链通过。

## 6. 治理同步

- [ ] 6.1 `docs/tech-debt.md` TD-12 更新计数与「第三刀已落地」；写明下一刀（plan-templates/DTO 级联）。
