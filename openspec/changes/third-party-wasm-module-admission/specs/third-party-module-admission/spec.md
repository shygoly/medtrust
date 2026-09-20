## ADDED Requirements

### Requirement: 准入分层且源码-only（不接受不透明二进制）
平台 SHALL 仅通过「可复现构建的源码」准入算法模块，准入只设两层：Tier A（平台自研源码）与 Tier B（第三方交源码、平台构建）。合约固定的模块 SM3 MUST 由平台在锁定工具链里从提交的源码复现产出；任何平台无法从源码复现出其 SM3 的 `.wasm` MUST 被拒。不设 Tier C：不透明第三方二进制 MUST NOT 被准入。

#### Scenario: 第三方交源码走 Tier B
- **WHEN** 第三方提交 Rust 或 AssemblyScript 源码，平台复现构建出 `.wasm` 且 SM3 可复现
- **THEN** 该模块以 Tier B 入册，平台 SM2 CA 签其 SM3

#### Scenario: 只交二进制、无源码即拒
- **WHEN** 提交方只给 `.wasm` 而不给可复现构建的源码
- **THEN** 平台复现不出该 SM3，MUST 拒绝入册（不进入任何后续闸）

### Requirement: 源码语言白名单
准入 SHALL 只接受 Rust 与 AssemblyScript 源码；其它语言的源码或产物 MUST 在提交环节被拒。

#### Scenario: 非白名单语言被拒
- **WHEN** 提交方提交非 Rust / 非 AssemblyScript 的源码或产物
- **THEN** 平台 MUST 在提交环节拒绝，并说明仅支持 Rust / AssemblyScript

### Requirement: 保密审查通道（IP 保护）
第三方 MAY 在保密（NDA）前提下把源码交平台审查与构建；平台对医院 SHALL 只公开模块 SM3 与平台审查背书，源码 MUST NOT 被公开。

#### Scenario: 保密源码只对平台可见
- **WHEN** 第三方以保密方式提交源码，平台完成审查与构建
- **THEN** 医院侧只看到模块 SM3 + 平台审查背书；源码不对外公开，但审查与复现构建照常完成

### Requirement: 闸 1 — 静态白名单校验
在任何执行之前，模块 MUST 通过静态校验：import 只允许「宿主提供的有上限内存」与白名单内的窄数据 API（出现 WASI / env / table / 共享内存等其它 import 一律拒）；export 必须与约定入口签名一致，且拒绝在实例化时偷跑的可疑 `start` 段；Wasm 特性走白名单（禁 threads / 共享内存）；声明的内存与模块字节大小 MUST 在上限之内。任一不满足 MUST 拒绝且不回退到内置实现。

#### Scenario: 含禁用 import 被拒
- **WHEN** 模块声明了 WASI / env / table / 共享内存等非白名单 import
- **THEN** 静态校验 MUST 失败，模块被拒，不进入执行

#### Scenario: 超内存或模块大小上限被拒
- **WHEN** 模块声明的内存上限或字节大小超过配置上限
- **THEN** 静态校验 MUST 失败并拒绝

### Requirement: 闸 2 — 复现构建与平台签名
`.wasm` MUST 由锁定版本、断网、hermetic 的工具链构建；两个独立构建器 MUST 产出同一 SM3；平台 SM2 CA SHALL 对该 SM3 签名后方可入册。

#### Scenario: 复现一致则签名入册
- **WHEN** 两个独立构建器对同一源码产出相同 SM3
- **THEN** 平台 SM2 CA 对该 SM3 签名，模块入册

#### Scenario: 构建不可复现即拒
- **WHEN** 两个独立构建器产出的 SM3 不一致
- **THEN** 模块 MUST 被拒（不可复现不予签名）

### Requirement: 闸 3 — 沙箱内动态测试
入册前模块 MUST 在真实沙箱里通过：与独立参考实现**逐字段一致**；N 次运行且跨两院运行时**确定性**（输出字节 / SM3 一致）；资源上限（超时 / 内存 / 指令预算 fuel）**确实触发**并只判任务失败、不波及连接器；对 malformed 输入只能优雅失败。任一不过 MUST 拒绝。

#### Scenario: 与参考实现逐字段一致
- **WHEN** 在注入真值的合成数据集上运行候选模块
- **THEN** 其输出 MUST 与独立参考实现逐字段一致（在容差内）

#### Scenario: 资源超限被终止且只失败任务
- **WHEN** 喂入触发死循环 / 内存膨胀的病态输入
- **THEN** 模块 MUST 在超时 / 内存 / 指令预算处被终止，任务判失败，连接器进程不受影响

### Requirement: 闸 3 — 防外泄（输出通道管控）
宿主 SHALL 只把「最小整数列投影」喂进沙箱（原始标识 MUST NOT 进入模块）。模块输出 MUST 对**行序**与任何**标识符扰动**不变；MUST 符合窄的**低熵输出 schema**（整数计数、限定值域）；MUST NOT 允许从输出复原注入的 canary 记录；且 MUST 仍经过既有输出闸门（小格 < 5 抑制、行级拦截）。

#### Scenario: 行序不变性
- **WHEN** 对同一多重集打乱行序后再运行
- **THEN** 模块输出 MUST 逐字节不变

#### Scenario: 超额精度 / 高熵输出被拒
- **WHEN** 模块把「计数」返成带多位尾数噪声的浮点，或输出熵超出声明 schema
- **THEN** 校验 MUST 失败并拒绝该模块

### Requirement: 闸 4 — 影子发布
新入册模块 MUST 先在一家医院真实数据上以**影子模式**运行（只计算、不向消费方释放结果），结果与参考比对、资源 / 输出形状可供该院 DPO 查验；影子干净后方可 SHALL 晋级（canary → 全量）。

#### Scenario: 影子模式不释放结果
- **WHEN** 模块处于影子模式
- **THEN** 其结果 MUST NOT 释放给消费方，只供比对与 DPO 查验

#### Scenario: 影子比对不过不晋级
- **WHEN** 影子运行与参考比对不一致或资源 / 输出异常
- **THEN** 模块 MUST NOT 晋级到生产

### Requirement: 闸 5 — 运行时常态防护
每次生产运行 MUST 验证 SM2 签名且 SM3 == 合约固定值、以零导入（除有上限内存）实例化、输出过闸门，并把模块 SM3 与 `executionIsolation` 写进受 SM3 保护的结果。沙箱 worker MUST 在 OS 层受限运行（seccomp 断 syscall、无网络命名空间、只读 FS、cgroup 限 CPU / 内存）。运行时 SHALL 优先 Wasmtime（fuel + epoch 中断）。

#### Scenario: SM3 与合约固定值不符当场拒
- **WHEN** 运行前模块 SM3 与合约固定值不一致
- **THEN** 连接器 MUST 当场拒绝执行，且不回退到内置实现

#### Scenario: OS 层兜底拦截引擎逃逸
- **WHEN** 模块试图借引擎漏洞发起 syscall / 联网
- **THEN** seccomp / 无网络命名空间 MUST 在 OS 层拦住，连接器不受影响

### Requirement: 模块吊销
入册模块 MUST 可吊销（撤签名 / 撤合约固定 / 进吊销名单）。吊销后，连接器在下次运行 MUST 拒绝执行该模块。

#### Scenario: 吊销后拒执行
- **WHEN** 某模块被吊销后，连接器再次领到引用它的任务
- **THEN** 连接器 MUST 拒绝执行（凭 SM3 不符 / 吊销名单），任务判失败
