# sandbox-live-provisioning Specification

## Purpose
TBD - created by archiving change wasm-sandbox-live-demo. Update Purpose after archive.
## Requirements
### Requirement: 固定模块演示合约
平台 SHALL 提供一份**固定算法模块**的演示数字合约（`pinnedModules`：分析类型 → 模块 SM3），使真实任务据此走沙箱路径。所固定的模块 SM3 MUST 在平台模块注册表内；不在册时合约 MUST 拒绝生成（fail-closed）。该固定模块条款 MUST 计入合约哈希。

#### Scenario: 固定在册模块 → 生成成功
- **WHEN** 对某数据产品种一份 `pinnedModules { disproportionality: <注册表内 SM3> }` 的合约
- **THEN** 合约生成成功、状态 active，固定条款计入合约哈希

#### Scenario: 固定不在册模块 → 拒绝
- **WHEN** `pinnedModules` 引用一个注册表里不存在的 SM3
- **THEN** 平台 MUST 拒绝生成该合约

### Requirement: 连接器 disproportionality 演示数据可取
连接器本地库 MUST 在对应数据产品的 `localDataPath` 下含 disproportionality 可执行的演示队列（记录带 `medications` 与事件词条），使 disproportionality 任务能取数进入执行，而非失败于「本地数据路径不存在」。

#### Scenario: 有数据 → 取数成功进入执行
- **WHEN** 连接器领到一个 disproportionality 任务且其产品 `localDataPath` 下有队列数据
- **THEN** 取数成功，进入 PEP → 执行器分支

#### Scenario: 无数据 → 失败于取数（对照）
- **WHEN** 产品 `localDataPath` 下无数据
- **THEN** 任务 MUST 失败于取数（说明演示数据必须先供给），不静默产出空结果

### Requirement: 生产端沙箱执行验收
固定了模块的 disproportionality 任务在生产端 MUST 走 Wasm 沙箱：连接器凭 SM2 证书按 SM3 拉模块（`GET /connector/modules/:sm3`）→ 双重校验（SM3 == 合约固定值 + 平台 CA 签名）→ 零能力沙箱执行 → 输出闸门 → 签名回传 → 控制面按院入库执行标注，且结果 `executionIsolation=wasm-sandbox`。未固定模块的同类任务 MUST 记 `executionIsolation=none`（TS 路径）。

#### Scenario: 固定模块任务 → wasm-sandbox
- **WHEN** 一个 disproportionality 任务命中固定模块的合约并在线上完成
- **THEN** 其结果 `executionIsolation=wasm-sandbox`，且携带模块 SM3（受结果 SM3 覆盖）

#### Scenario: 无固定模块任务 → none
- **WHEN** 一个 disproportionality 任务命中无固定模块的合约
- **THEN** 其结果 `executionIsolation=none`（回退内置 TS 路径）

#### Scenario: 模块拉取或校验失败 → 任务失败不回退
- **WHEN** 固定模块任务下连接器拉不到模块、或 SM3/签名校验不过
- **THEN** 任务 MUST 判失败，**不回退**到 TS 实现

