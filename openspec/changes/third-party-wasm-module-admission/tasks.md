## 0. 前置与治理

- [x] 0.1 确认 `connector-wasm-sandbox-disproportionality` 已归档（`algorithm-sandbox` 成基线）
- [x] 0.2 DECISIONS 新增 `D-CN-5`：只接受可复现构建的源码模块、不接受不透明第三方二进制、IP 走保密审查；`node scripts/check-meta-docs.mjs` 绿
- [x] 0.3 TRUST 新增 `P-CTL-7`（第三方算法准入闸）；DOMAIN 增补「准入层级 A/B、审查背书」词汇；D-CN-2 补注多语言 + 运行时兜底
      —— 落地后 `P-CTL-7` 现状已更新，并升格出正册 `CTL-24`；DOMAIN 增「算法模块准入」小节（INV-ADMIT-01/02/03）

## 0.5 闸 0 —— 源码预检 + 隔离构建（**规格外补充**，2026-09-20）

> 原规格的五道闸全部管**产物**与**运行期**，漏了一个执行点：`cargo build` 会跑第三方的
> `build.rs` / proc-macro，`asc` 会 `require()` `asconfig.json` 的 `transform`。
> 编译期以宿主权限执行任意代码，而闸 1 只看 `.wasm`、闸 3 只看运行期 —— 谁都没覆盖它。

- [x] 0.5.1 闸 0 源码预检（编译**之前**跑）：拒 `build.rs` / `[package].build` /
      `[build-dependencies]` / 非空依赖 / proc-macro crate / `.cargo` 配置（可设 runner、linker）/
      `[workspace]` / `asconfig.json` 的 `transform` / `asconfig.js` / `package.json` scripts /
      夹带 `node_modules` —— `src/source-gate.ts`，16 类负例 + 正例（`src/source-gate.test.mjs`）
- [x] 0.5.2 隔离构建器镜像：`Dockerfile.builder` + `build-rust.sh`，
      `--network=none --read-only --cap-drop=ALL --user 10002 --pids-limit` 且**不挂任何凭据**；
      入口丢弃提交方夹带的 `target/` / `.cargo/`，强制从零重编译（已验证夹带的预构建产物不会被复用）
- [x] 0.5.3 隔离模式开关 `WASM_BUILD_ISOLATION`（缺省 `container`）：`host` 必须显式设，
      **不做静默回退**——静默回退等于隔离没做
- [x] 0.5.4 **实测**：容器构建与宿主构建**逐字节一致**（SM3 同为 `91359f79…`，切隔离不会让已入册模块失配）；
      容器产物零导入实例化 + 调 `run` 结果与独立核算一致；植入 `build.rs` 的负例在编译**之前**被拒且从未执行
- [x] 0.5.5 目录整理：Tier A / Tier B 统一为**提交形状** `modules/<name>/`（只放源码，无 npm/cargo 之外的工程机制），
      闸 0 对两层一视同仁——「分层」是来源标注，不是安全豁免。迁移后 AS 产物 SM3 不变（`b2760b0c…`）

## 1. 源码语言与复现构建（闸 2）

- [x] 1.1 `packages/wasm-algorithms` 增加 Rust 工具链（锁版本、hermetic、断网），产出带 SM3 清单
      —— `rust/disproportionality/`（no_std、零依赖、`rust-toolchain.toml` 锁 1.95.0）；
      `scripts/toolchains.mjs` 固定链接参数（`--import-memory --no-entry`、内存上下限、`--remap-path-prefix`）
      与 hermetic 环境（`CARGO_NET_OFFLINE=true`、`SOURCE_DATE_EPOCH=0`、最小环境变量）
- [x] 1.2 复现构建校验：两个独立构建器对同一源码产出**同一 SM3**，不一致即拒
      —— `scripts/admission.mjs#reproduceAndGate`（两个互不相干的临时 target 目录）；
      `scripts/admission.test.mjs` 真跑两遍 cargo 对拍，并验证改一个字节 SM3 就变
- [x] 1.3 平台 SM2 CA 对复现出的 SM3 签名、入册的接口
      —— `ModuleAdmissionService.triggerBuild`（复用 `CaService.signModuleDigest`，签名写进审查背书）
- [x] 1.4 源码语言白名单：只收 Rust / AssemblyScript，其它拒（含负例）
      —— `toolchains.mjs#assertSourceLanguage` + `detectLanguage`（识别不出即拒）；提交接口同样校验
- [x] 1.5 保密审查通道：NDA 源码只对平台可见，对医院只出 `SM3 + 背书`
      —— 源码**不入库**（只存 `sourceRef`）；`ModuleAdmissionService.publicView` 只出 SM3/层级/背书，
      用例断言公开视图里不含源码引用

## 2. 静态白名单校验（闸 1）

- [x] 2.1 import 白名单校验器：只允许有上限内存 + 窄数据 API；WASI / env / table / 共享内存一律拒
      —— `src/static-gate.ts`；**窄数据 API 的实际口径是「全部预投影一次性喂入」**（design 开放问题的结论），
      因此除 `env.memory` 外不开任何 import，比规格更紧
- [x] 2.2 export 签名固定校验 + 拒可疑 `start` 段
      —— `abi_version` 允许「常量全局」或「无参函数」两种形态（Rust/wasm-ld 导不出值型全局）；
      工具链链接常量 `__heap_base` / `__data_end` 按**精确枚举**放行且必须是 global，其余符号照旧拒
- [x] 2.3 Wasm 特性白名单（禁 threads / 共享内存；按需禁 SIMD / GC / 异常）
      —— threads/共享内存、GC 类型、tag 段（异常）、表、memory64 全部**结构化**判定；
      **SIMD 例外**：本闸按结构判定，无法在不做 opcode 扫描时禁 SIMD，`allowSimd:false` 会**如实报错说它管不了**，
      不假装禁掉（要真禁须换支持指令级校验的引擎，归 P-CTL-5）
- [x] 2.4 内存上限 + 模块字节大小上限校验
- [x] 2.5 静态拒绝集测试：每类违规一个负例，全部 fail-closed
      —— `src/test-fixtures.ts` 19 类 + `src/static-gate.test.mjs`（含「解析不动一律拒」与真实产物正例）

## 3. 沙箱动态测试闸（闸 3）

- [x] 3.1 一致性：注入真值合成集 + 独立参考实现逐字段对拍
      —— `admission-gates.spec.ts` 拿**真的 Tier B Rust 模块**对拍内置 TS `disproportionalityTables`
- [x] 3.2 确定性：N 次 + 跨两院运行时，输出字节 / SM3 一致
- [x] 3.3 资源上限确实触发：超时 / 内存各一负例，验证只判任务失败、连接器不倒
      —— 资源上限为 worker + watchdog terminate + 内存上限。**fuel（确定性指令预算）按决策不做**（见 5.1）：
      裁决用墙钟、跨院可能不一致，但不一致只导致偶发任务失败（fail-closed 方向），不产生错误结果
- [x] 3.4 防外泄：最小整数列投影（原始标识不进模块）
- [x] 3.5 防外泄：行序不变性差分（打乱多重集 → 输出不变）
- [x] 3.6 防外泄：输出 schema 低熵约束（拒超额精度 / 高熵输出）
      —— `src/output-schema.ts#assertLowEntropyOutput`（整数 / 值域 / 固定 arity / 信息量上限）
- [x] 3.7 防外泄：canary 记录不可复原 + 叠加既有输出闸门（小格<5 / 行级拦截）
      —— `canaryLeakFields` 差分；输出闸门沿用既有 OutputGate（CTL-20 链路未变）
- [x] 3.8 模糊测试：malformed 输入（空队列 / 全同 / 高基数 / 全未暴露）只能优雅失败

## 4. 影子发布（闸 4）

- [x] 4.1 影子模式：只算不发结果；结果与参考比对、资源 / 输出形状可查
      —— 状态机 `shadow` + `isReleasableStatus()`（影子 MUST NOT 释放给消费方）
- [x] 4.2 DPO 查验入口 + 晋级流程（canary → 全量），干净才晋级、不过不晋级
      —— `POST submissions/:id/shadow{,/conclude}` + `promote`；`canPromote` 保证不得跳闸，
      影子不干净直接 `rejected`

## 5. 运行时常态防护 + 吊销（闸 5）

- [x] 5.1 引擎切 Wasmtime（fuel + epoch）—— **决策为不做**（2026-09-20，登记在 D-CN-5 落地补注 + CTL-24 note + P-CTL-5）
      Wasmtime 的两项收益分开看：
      · **fuel（确定性资源裁决）→ 不追求**。资源上限本身保留（超时 terminate + 内存上限，3.3 有负例），
        只是裁决用墙钟、跨院可能不一致；不一致的唯一后果是**偶发任务失败**，方向上 fail-closed，不产生错误结果。
        算法正确性已由闸 2（可复现源码 + 人审）与闸 3.1（与独立参考实现逐字段对拍）保证，fuel 的边际收益不抵代价。
      · **进程隔离（防引擎逃逸）→ 仍有价值**，继续留在 `P-CTL-5` 作为待接入，不因本条注销；
        当前由 OS 层兜底（cap_drop / 只读 FS / internal 网络 / seccomp overlay）承担。
      代价侧事实：Node 无可用 Wasmtime 绑定（`@bytecodealliance/wasmtime` 在 npm 不存在，社区 `wasmtime` 停在
      0.0.2 / 2023-05），真要上须把沙箱 worker 改写成 Rust 独立执行进程，等同一个独立变更。
- [x] 5.2 OS 层兜底：seccomp profile + 无网络命名空间 + 只读 FS + cgroup 限额，罩住沙箱 worker
      —— `deploy/ali29/seccomp-connector.json`（白名单 `SCMP_ACT_ERRNO`，另禁 mount/ptrace/bpf/unshare/setns/
      process_vm_* 等逃逸后横向移动的调用；`clone` 按掩码拒新建命名空间，`clone3` 回退）
      + `deploy/ali29/compose.seccomp.yaml`（**单独一层，可单独摘掉**）。
      无网络命名空间 / 只读 FS / cgroup 限额沿用既有 `compose.hardening.yaml`。
      **已实测**（2026-09-20，Linux 6.10.14 x86_64 / Docker 28.5.1，镜像 `medtrust-rws-worker-a:local`）：
      ① Node 20 在 profile 下正常启动；② 沙箱真实路径全通（worker_threads 派生 + 零导入 Wasm
      实例化 + 调 `run` 结果与独立核算一致 + 死循环 `terminate()`；worker 内 env 变量数 = 0）；
      ③ 连接器真实 entrypoint running / 0 restarts / **0 EPERM**，出站轮询循环已启动；
      ④ **反证 profile 生效**：从白名单去掉 `getrandom` 后 Node 启动即崩。
      残留差异：ali29 内核版本与实测环境不同，首次上机仍按文件头部步骤核对日志
- [x] 5.3 每次运行：验 SM2 + SM3 == 合约固定值 + 零导入实例化 + 过闸 + 写模块 SM3 / `executionIsolation` 进签名结果
      —— `verifyModule` 顺序：吊销 → SM3 → SM2 → 闸 1 → 编译；执行标注与模块指纹入库路径未变（CTL-20）
- [x] 5.4 模块吊销：撤签名 / 撤合约固定 / 吊销名单；PEP 执行前检查，吊销即拒、不回退
      —— 名单随**每个**长轮询批次（含空批次）下发；版本单调递增，连接器只收更高版本（防回放），
      收下即清掉被吊销模块的本地缓存；PEP 与 `verifyModule` 两处独立检查
- [x] 5.5 负例：SM3 不符 / 已吊销 → 当场拒、不回退到内置实现

## 6. 数据与控制面

- [x] 6.1 控制面模块准入接口：源码提交、构建触发、审查状态、影子、吊销
      —— `apps/api/src/runtime/connector-modules/module-admission.{service,controller}.ts`。
      **信任边界（2026-09-20 修正）**：控制面**不编译**第三方代码，也**不挂 docker.sock**
      （docker socket ≡ 宿主 root，比装编译器更糟）。生产路径是
      `POST submissions/:id/attest-build`：独立构建环境交 ≥2 份产物字节，控制面**自己**
      重算 SM3 → 要求全部相同 → 自己跑闸 1 → CA 签名。**不采信提交方声称的 SM3**。
      原先由 api 自行构建的 `POST .../build` 降级为本地 demo 专用，缺省禁用
      （`MODULE_LOCAL_BUILD_ALLOWED`）。运维手册见 `packages/wasm-algorithms/BUILDER.md`
- [x] 6.2 DB（控制面实体）：合约固定模块列加层级 + 审查背书；新增模块吊销表；派发记录带层级 + 背书
      —— `cp_module_admission` / `cp_module_revocation`；`cp_digital_contract.pinnedModules` 兼容
      「纯 SM3（旧，Tier A）」与「{sm3,tier,review}（新，Tier B）」两种形态
- [x] 6.3 数字合约：固定模块条款含层级 + 背书、计入合约哈希 + 存证；缺层级或背书视为无效
      —— `normalizePinnedModules` 整体归一（含背书内部键排序）后计入哈希；
      `validatePinnedModuleClause` 在合约生成与连接器 PEP **两处**校验
- [x] 6.4 结果入库读执行标注（层级 / 隔离 / 模块指纹），写存证元数据 + 界面显示
      —— 派发 DTO 增 `moduleAdmission{tier,review}`（从合约条款读，只在实际跑了固定模块时标）

## 7. 前端

- [x] 7.1 任务详情显示准入层级（A / B）、审查背书、执行隔离与模块指纹
      —— `admissionTierLabel` / `reviewAttestationLabel`；文案刻意不说「平台保证安全」，
      只说「平台拿到源码、复现构建出这个 SM3 并审查过」

## 8. 部署与验收

- [x] 8.1 连接器镜像 + seccomp profile；ali29 重建带 hardening overlay
      —— 见 5.2：profile 与 overlay 已交付**并实测通过**（沙箱全路径 + 真实 entrypoint，0 EPERM）。
      另交付**隔离构建器镜像**（`Dockerfile.builder`），同样在本机 docker 实测构建 + 执行通过
- [x] 8.2 端到端正例：一个 Tier B Rust 模块走完五道闸（含影子）到生产、结果 completed
      —— `admission-e2e.spec.ts`（真字节 + 真沙箱 + 真 SM2）＋ `module-admission.spec.ts`
      的全流程状态机（submitted → built → tested → shadow → canary → active）
- [x] 8.3 负例总验收：不透明二进制 / 复现不出 SM3 / 静态违规 / 资源超限 / 外泄探针 / 吊销，全部 fail-closed
      —— `admission-e2e.spec.ts` 后半段逐条

## 未做 / 待验证（如实清单）

1. **Wasmtime fuel（5.1）：决策为不做，不是欠账**。规格 design D4「Tier B 用 Wasmtime 的 fuel + epoch
   做确定的资源上限」这一条**有意不满足**，理由见 5.1 与 D-CN-5 落地补注。资源上限本身在。
   「进程隔离」那一半仍是待接入项（P-CTL-5），与本条无关。
2. **连接器 seccomp profile 在 ali29 上的首次核对（5.2 / 8.1）**：profile 已在本机 Linux 6.10
   容器实测通过（含反证 profile 真在执行）。**剩余的不是「没验」而是「换内核没验」**——ali29 内核
   版本不同，理论上可能用到白名单外的调用。首次 `up -d` 后看一遍 `docker logs` 确认 0 EPERM
   再并入常规部署命令；出问题去掉 `-f compose.seccomp.yaml` 一层即可回退。
3. **禁 SIMD（2.3）**：结构化闸做不到，已如实报错而非假装禁掉。
4. **第三方依赖暂不支持**（闸 0）：`[dependencies]` 必须为空——任何依赖都可能自带
   `build.rs` 或 proc-macro，会把审查面扩散到平台没审过的代码。要放开须走 vendored + 白名单，另立变更。
5. **影子时长 / canary 家数阈值**：状态机与「干净才晋级」已落地，但具体阈值与「谁判定干净」
   仍是运营决策（design 开放问题），代码里只要求显式给出 `clean` 结论与 `reviewedBy`。
