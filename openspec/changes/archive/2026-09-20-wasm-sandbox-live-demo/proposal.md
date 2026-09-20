## Why

`connector-wasm-sandbox-disproportionality`（D-CN-2，已归档）把 Wasm 沙箱能力部署到了 ali29 并在加固连接器容器内验证可运行，但**没有任何真实任务走过沙箱路径**——`executionIsolation=wasm-sandbox` 在线上从未产生（该 change 的 7.1 待补）。缺两样：① 没有**固定模块的合约**（`pinnedModules {disproportionality: <SM3>}`）；② 连接器本地缺 **disproportionality 演示数据**——AMR 数据产品的 `localDataPath` 指向 `/data/synthetic/amr/connectors/<site>`，而连接器镜像只烘焙了 `/data/rws-injected`，disproportionality 任务因「本地数据路径不存在」失败于取数。结果：沙箱「已部署但空转」，对外只能说「已实现」，说不了「在用」。

## What Changes

分两阶段，先证「在用」，再出「有意义的信号」：

- **阶段 1 · 最小活体闭环（证 `executionIsolation=wasm-sandbox`）**
  - 平台**种一份固定模块的演示合约**：对一个**已烘焙数据**的数据产品（`rws-injected` 胰岛素队列，记录含 `medications`/`adverseEvents` 字段）绑定 `pinnedModules { disproportionality: b2760b0c… }`，`SM3` 计入合约哈希。
  - 跑一个 **disproportionality 任务**（drug=insulin）走完整链路：连接器凭 SM2 证书拉模块（`GET /connector/modules/:sm3`）→ 双重校验（SM3 == 合约固定值 + 平台 CA 签名）→ 零能力沙箱执行 → 输出闸门 → 签名回传 → 控制面按院入库执行标注 → 前端显示「Wasm 沙箱 + 模块指纹」。
  - **验收 = 该任务 `executionIsolation=wasm-sandbox`**（对照：无固定模块合约仍 `none`）。胰岛素队列 AE 稀疏、信号平凡，但**路径为真**。

- **阶段 2 · 供给真实 disproportionality 数据集（出有意义信号）**
  - 把 AMR 耐药「以耐药为事件」的数据集（`data/synthetic/amr/connectors/<site>`，脚本可复现生成）**供给到连接器**：随镜像烘焙（对齐现有 `rws-injected` 非 git 数据的烘焙方式）或挂卷，落到该产品 `localDataPath`。
  - 对 AMR 数据产品种固定模块合约 + 跑 disproportionality 任务，得到非平凡的 a/b/c/d 失衡信号，经小格抑制后回传。

- **不改沙箱本身**：`algorithm-sandbox`（已归档）的执行/签名/校验语义不变；本变更只做**演示供给 + 生产验证**，把「已部署」推到「在用」。

## Capabilities

### New Capabilities
- `sandbox-live-provisioning`：让已部署的 Wasm 沙箱在线上被真实任务执行所需的演示供给与验收——连接器侧 disproportionality 演示数据集、平台侧固定模块种子合约、以及生产端 `executionIsolation=wasm-sandbox` 的端到端验收口径（对照无固定模块回退 `none`）。

### Modified Capabilities
- `rws-test-data-injection`：连接器演示数据集**增列 disproportionality 队列**（记录含 `medications` + 事件词条 `adverseEvents`），并明确其 `localDataPath` 供给方式（镜像烘焙 / 挂卷），使 disproportionality 任务可取数执行。

> 关系：`algorithm-sandbox`（D-CN-2，已归档）提供沙箱执行/签名/校验；`digital-contract` 已支持 `pinnedModules`（同批归档）；本变更复用二者，只补「数据 + 种子合约 + 生产验收」，不新增其需求。

## Impact

- **连接器数据**：新增 disproportionality 演示队列供给（阶段 1 复用 `rws-injected`；阶段 2 供给 AMR 数据集，烘焙进 `Dockerfile.connector` 或挂卷）。AMR 生成脚本已在 `scripts/amr/`。
- **控制面 / 种子**：新增固定模块演示合约的种子（`pinnedModules` 引用注册表内的模块 SM3；平台在合约生成时校验 SM3 在册——注册表已装载 `b2760b0c…`）。
- **ali29 部署**：阶段 2 需连接器镜像重建（带 `-f compose.hardening.yaml`）以烘焙 AMR 数据；阶段 1 无需重建（数据已在）。
- **验收/测试**：端到端断言 `executionIsolation=wasm-sandbox`（固定模块）与 `none`（无固定模块）两分支；模块经证书拉取 + 双重校验通过；结果 SM3 覆盖执行标注、前端如实显示。
- **文档**：架构图 `docs/architecture-overview.html` 的 Wasm 状态由「已部署·待实跑」推进到「在用」；`connector-wasm-sandbox-disproportionality` 7.1 待补随阶段 1 达成而关闭。
