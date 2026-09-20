## 0. 前置确认

- [x] 0.1 复核注册表已装载 disproportionality 模块（SM3 `b2760b0c…`）且用当前 CA（`046eb66d`）动态签名（本会话已验）
- [x] 0.2 复核 compliance 预审网关不拦 disproportionality（本会话提交已过闸，仅失败于取数）

## 1. 阶段 1 — 种固定模块合约（复用已烘焙数据）

- [x] 1.1 选定阶段 1 数据产品 + 消费方 + 目的（复用 `rws-injected` 胰岛素产品；purpose 与合约一致）
- [x] 1.2 经 `ContractService.approve` 种一份 `pinnedModules { disproportionality: b2760b0c… }` 的合约（哈希经 canonical 正确计算、SM3 在册校验通过；**禁止 DB 直写 pinnedModules**）
- [x] 1.3 (不需要) 若胰岛素队列无 AE 词条（`k` 会为 0），给阶段 1 队列注入少量演示 AE 词条使 `k>0`（仅演示，不影响 executionIsolation）

## 2. 阶段 1 — 跑通 + 验收

- [x] 2.1 提交 disproportionality 任务（drug=insulin，带 designType/rationale/sap）命中固定模块合约
- [x] 2.2 连接器凭 SM2 证书拉模块 + 双重校验（SM3==固定值 + 平台 CA 签名）+ 零能力沙箱执行 + 输出闸门 + 签名回传（连接器日志无 401/校验失败）
- [x] 2.3 **验收**：任务 `executionIsolation=wasm-sandbox`、携带模块 SM3；对照无固定模块合约任务 = `none`
- [x] 2.4 (字段已populated,UI 组件见 base 6.1) 前端任务详情显示「Wasm 沙箱 + 模块指纹」（核对 disproportionality 任务视图）

## 3. 阶段 2 — 供给 AMR 数据集

- [x] 3.1 用 `scripts/amr/` 可复现生成两院 AMR「以耐药为事件」数据集
- [x] 3.2 烘焙进 `Dockerfile.connector`（按 `SYNTHEA_CONNECTOR` 选院，落到产品 `localDataPath`），对齐 `rws-injected` 供给方式
- [x] 3.3 重建连接器镜像 + 重建容器（`-f compose.yaml -f compose.hardening.yaml`），验证数据在容器内

## 4. 阶段 2 — 跑通 + 验收

- [x] 4.1 对 AMR 数据产品种固定模块合约
- [x] 4.2 提交 disproportionality 任务（AMR drug）→ 沙箱执行 → 非平凡 a/b/c/d，小格抑制后回传
- [x] 4.3 验收：`executionIsolation=wasm-sandbox` + 有意义失衡信号 + 与 TS 参考逐字段对拍（如可）

## 5. 收尾

- [x] 5.1 架构图 `docs/architecture-overview.html`：Wasm 状态「已部署·待实跑」→「在用」
- [x] 5.2 关闭 `connector-wasm-sandbox-disproportionality` 的 7.1 待补（在其归档记录 / 本 change 注明）
- [x] 5.3 更新 `ali29-deploy` 记忆：Wasm 在用 + 固定模块合约种法 + AMR 数据烘焙
