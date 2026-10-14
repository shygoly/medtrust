# 证据：节点侧沙箱走 S2 —— 竖切 ve-tnd（2026-10-14）

本轮只做**一条竖切**（rws.ve-tnd@1.0.0），把 S-B 形态、宿主适配器与三重闸先跑通；
其余三条（pairing / scri / dedup-incidence）按同一形态接入。

## 1. 形态落地

- **SPI**：StageSandbox / SandboxHost / SandboxRunRequest / SandboxRegistry + OperatorPack.declareSandboxes?（仍不新开缝）。
- **基座**：apps/connector/src/tee-node/sandbox-registry.ts（域中立）+ wasm-runner.ts 内的 buildSandboxHost；
  分派处先查注册表，未注册则回落内置分支（未迁移算子行为一字不变）。
- **包**：industries/med/src/sandboxes/（ve-tnd-sandbox.ts 搬运 + ve-tnd.ts 的 runStage），
  由 medSandboxes() / registerMedSandboxes() 声明；组装根 apps/connector/src/app.module.ts 注册，
  单测经 jest setupFiles（apps/connector/src/test/register-sandboxes.ts）同源注册。

## 2. 三条出域判据仍在基座（不动清单的落实位置）

| 判据 | 留在哪 |
|---|---|
| 错误文案不带数据 | createNodeWasmRunner 的统一 try/catch（非 MdopError 只进本地日志，对外固定文案） |
| 编码白名单参数 | buildSandboxHost.codeWhitelist 闭包到 optionalCodeWhitelist（包只能调宿主的） |
| 分层键闭合语法（入参侧） | buildSandboxHost.strataKeys 闭包到 checkedStrataKeys |
| 分层键闭合语法（结果侧） | createNodeWasmRunner 里对 produced.payload 的 assertResultStratumKeys 复校 |

三条执行前判据（算子白名单 / op_digest 核对 / 模块字节）也仍在 createOperatorDispatch。

## 3. 等价性与纯度

- 搬移的 sandbox 实现：**SAME（逐字节同体）**（与 git HEAD 里的原文件比对，去掉新增的 2 行 SPDX 头）。
- **连接器全量：136 套件 / 909 用例通过**（3 跳过），ve-tnd-sandbox.spec.ts 5/5。
- check-kernel-purity：importViolations = 0；目标布局越界 227 → **223**；棘轮基线 205 → **201**。

## 4. 仍未做

- pairing(16) / scri(2) / dedup-incidence(4) 三条及它们在 runner 里的执行分支（同一形态）；
- plan-templates.ts(49) + mdop.controller.ts(16)（需要模板注册缝，且 DTO 级联，另立一刀）。
