## Context

- **现状执行路径**（L1.5 失衡检测）：`connector-worker` → `connector-task-runner` → `RwsExecutor.run()` → `LocalStore.aggregateInternal()`（本地库守卫）→ `SoftwareSealedCompute.run(fn)`（同进程、无隔离，见 CTL-09）→ `disproportionalityTables(cohortRows, drug)`（`apps/connector/src/domain/rws-executor.ts`）→ `OutputGate.pass()` → `control-plane-client` 做 JSON 规范化后算 SM3 → `POST /connector/rws/assignments/:id/complete` → API 用 `aggregateSm3()` 验哈希后入库。
- **现有 2×2 语义**：按事件词条的首次出现顺序收集词条；每个词条 a = 用药且发生、c = 未用药且发生、b = 用药人数 − a、d = 未用药人数 − c；`rate = +(a / (n || 1)).toFixed(4)`；按 a 降序稳定排序；`cohortSize` = 入组行数。
- **信任锚**：平台 SM2 CA 在 `apps/api/src/runtime/participant-identity/ca.service.ts`（`gm.sm2Sign`，根密钥存库）。连接器目前没有平台公钥，也没有验签代码。
- **约束**：API 全局 `ValidationPipe({ whitelist, forbidNonWhitelisted })`，但结果接口的请求体是内联类型（`{ aggregate?: unknown; error?: string }`），`aggregate` 内部不做校验。09-15 曾因两侧哈希对象不一致导致回传被拒，任何进入聚合结果的新字段都必须走同一规范化流程。
- **运行环境**：ali29 上的连接器容器已加固（非 root、只读根文件系统、无外网，见 `deploy/ali29/compose.hardening.yaml`）。Node 20，无 Wasmtime。

## Goals / Non-Goals

**Goals:**
- 在连接器内建立能力受限的 Wasm 执行机制：签名 + 合约固定 + 运行前校验 + 资源上限 + fail-closed。
- L1.5 失衡检测作为首个模块运行，输出与 TS 实现逐字段一致。
- 执行隔离如实标注（`executionIsolation`），受结果哈希保护，贯穿控制面入库、存证和界面。

**Non-Goals:**
- 不做 Wasmtime，不做独立进程隔离，不做硬件 TEE（`attestationLevel` 保持 `software`）。
- 不开放药企自带算法模块。本次模块只来自平台仓库，由平台签名。
- 不迁移 L2 及以上的分析类型，不改跨院合并逻辑。
- 不新建算法模块数据库表；专用算法签名密钥（与 CA 根密钥分离）留给 P-CTL-6 完整落地。

## Decisions

### D1 运行时：Node 自带 WebAssembly + worker 线程（Wasmtime 为目标）
每次执行启动一个 `worker_threads` Worker：`env: {}`，`execArgv: []`，设置 `resourceLimits`。worker 内只做编译、实例化、写入输入、调用 `run`、读出结果，通过 `postMessage` 传回字节。宿主等待超时就 `worker.terminate()`（V8 在 Wasm 循环里插了中断检查，死循环同样能终止）。
- **备选：Wasmtime 独立进程**。有 fuel 计量，隔离更强；但要引入 Rust 二进制和进程间通信。放在下一步，接口保持不变（`SandboxRunner` 抽象）。
- **备选：`vm` / `isolated-vm` 跑 JS**。`vm` 不是安全边界；`isolated-vm` 是原生依赖，而且仍能执行任意 JS。不采用。
- **如实说明**：沙箱与连接器同一进程。`wasm-sandbox` 表示「代码能力受限」，不表示进程隔离或保密。一旦出现 V8 逃逸，风险由容器加固兜底。

### D2 能力策略：只允许导入一块有上限的内存
加载前用 `WebAssembly.Module.imports()` 检查：导入必须**恰好**是 `{module:'env', name:'memory', kind:'memory'}`；其他任何导入（函数、表、全局量、WASI）一律拒绝。宿主创建 `new WebAssembly.Memory({ initial, maximum })` 注入，模块无法突破上限。导出必须包含 `run` 函数和常量全局 `abi_version`（本次为 1）。
- **备选：模块自带导出内存**。实例化之前无法可靠检查它声明的上限，不采用。
- **备选：WASI**。等于授予文件、环境变量、时钟等能力，违背 D-CN-2，不采用。

### D3 ABI 与数据布局（小端，宿主写入）
`run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32`，返回 0 表示成功。
- 输入：`included[n]`、`exposed[n]`（各占 1 字节，取值 0/1），`events[n*k]`（行优先，0/1），从 `inOff` 连续排布。
- 输出：`cohortSize`（u32），然后是 `k` 组 `a, b, c, d`（u32）。
- 宿主先算所需字节数，超过内存上限就在调用前拒绝，并给出明确错误。
- 词条文本只在宿主一侧：宿主**按首次出现顺序**建立 词条 → 下标 映射（复现 TS 的 `Set` 插入顺序），回填 `key`；再按 TS 同一规则算 `rate`，按 a 降序做稳定排序，保证逐字段一致。
- 宿主对输出做不变量校验：`a+b` 等于入组内用药人数，`c+d` 等于入组内未用药人数，各格 ≥ 0，`cohortSize ≤ n`。任何一项违反即判失败，防止有缺陷或恶意的模块输出自相矛盾的计数。
- **备选：内存里传 JSON**。模块内部要解析器，攻击面和体积都会变大，不采用。

### D4 模块构建与来源：`packages/wasm-algorithms`（AssemblyScript，锁定版本）
- 源码 `assembly/disproportionality.ts`。
- 编译参数固定：`--runtime stub --importMemory --maximumMemory <pages> --use abort= -O3`，保证只导入内存、没有 `env.abort`。
- 构建产物 `.wasm` 和 `manifest.json`（分析类型、ABI 版本、SM3、编译器版本）入库。CI 重新构建并比对 SM3，作为可复现性闸门；院方可以用源码加编译器版本复现同一 SM3。
- **备选：Rust**。工具链不在仓库内，团队以 TS 为主，放在后续。
- **备选：手写 WAT**。最易审计，但不适合后续复杂算法。

### D5 签名与信任锚：合约固定 + 平台签名，两项独立校验
- 平台 CA 对 `sm3(模块字节)` 做 SM2 签名。连接器用部署配置里的 `CONNECTOR_PLATFORM_CA_PUBKEY` 验签，这个公钥**不从控制面同一条通道获取**，避免控制面被攻破时连模块带公钥一起伪造。
- 合约固定模块 SM3：院方批准合约，就等于同意运行这一份具体代码。
- 两项校验缺一不可，任一失败都拒绝执行，**不回退到 TS**。
- **备选：只验签不固定**。院方没有对具体代码表示同意，不采用。
- **备选：只固定不验签**。缺少平台审计背书，不采用。
- **备选：从控制面拉取 CA 公钥**。形成循环信任，不采用。

### D6 模块分发：`GET /api/v1/connector/modules/:sm3`
- 复用现有连接器鉴权。API 启动时从 `packages/wasm-algorithms/build/` 读取模块，建内存注册表（SM3 → 字节、签名、ABI）。
- 连接器按 SM3 在内存里缓存已校验通过的模块。
- 派发记录里新增 `module: { analysisType, sm3 }`，告诉连接器该用哪个模块。
- **备选：打包进连接器镜像**。无法按合约固定，也堵死了日后接纳外来模块的路，不采用。

### D7 执行隔离标注：写在聚合结果内部，受哈希保护
- 连接器在输出闸门之后、规范化与算哈希**之前**写入 `aggregate.execution = { isolation: 'wasm-sandbox' | 'none', moduleSm3?, abiVersion? }`。两侧继续用同一个 `stableStringify` + SM3，API 的 `aggregateSm3()` 不用改就能覆盖这个标注。
- API 入库时：
  - `isolation` 只接受 `none` 或 `wasm-sandbox`，其他值返回 400（fail-closed）；
  - 没有这个字段的旧版连接器，按 `none` 处理；
  - 写入 `cp_rws_assignment.executionIsolation / moduleSm3`；
  - 任务级取所有医院中最弱的一级（任何一家是 `none`，任务就是 `none`）。
- 存证元数据增加 `executionIsolation` 和模块 SM3 列表；`attestationLevel` 不变。
- 部署顺序无关：API 本来就对 `aggregate` 整体算哈希，不认识的字段也在哈希范围内；旧版 API 忽略这个字段。
- **备选：放在请求体顶层**。不在哈希范围内，可被篡改，不采用。

### D8 执行路径选择与失败语义
- PEP 读取合约的 `pinnedModules`：该分析类型固定了模块时，派发记录里的模块 SM3 必须一致，否则拒绝（记 `pep-deny`）。
- 执行器按以下顺序处理：取模块 → 校验 SM3 与签名 → 检查导入与导出 → 在 worker 内运行 → 校验不变量。任何一步失败，任务即失败，写明具体原因，记 `sandbox-fail` 审计。
- 合约没有固定模块时，走 TS 路径并标注 `none`。

### D9 与 SoftwareSealedCompute 的关系
沙箱调用仍包在 `SoftwareSealedCompute.run()` 里面，对应 D-CN-2「理想是沙箱跑在 TEE 内」：以后换成硬件 TEE，沙箱就自然运行在飞地内。本地审计同时记两条：`tee-run`（软件级）和 `sandbox-run`（模块 SM3、耗时、内存页数）。

### D10 资源上限（可配置，登记进 DEPLOY）
- `CONNECTOR_SANDBOX_TIMEOUT_MS`：缺省 10000。
- `CONNECTOR_SANDBOX_MAX_MEMORY_MB`：缺省 64。
- worker 的 JS 堆上限较小（胶水代码很少）。
- 超限：终止 worker，任务失败，不回退。

## Risks / Trade-offs

- [V8 逃逸：沙箱与连接器同一进程] → 容器已加固（非 root、只读、无外网）；worker 不继承环境变量和密钥；标签如实写成「能力受限」而非「隔离」；下一步换 Wasmtime 独立进程。
- [Wasm 与 TS 结果漂移：并列时的顺序、rate 的舍入] → 宿主复现首次出现顺序和同一排序、舍入规则；在 Synthea 与注入信号数据集上做一致性测试。
- [重演 09-15 哈希故障] → 执行标注写在规范化之前；新增两侧哈希一致的回归测试。
- [AssemblyScript 在不同平台上构建结果不一致] → 锁定编译器版本；CI 重建比对 SM3；`.wasm` 入库。
- [CA 根私钥存库，签名密钥与 CA 根密钥未分离] → 本次不解决，登记在 P-CTL-6。签名范围仅限平台仓库内的模块。
- [上线 ali29 要重建 API，会清空控制面 SQLite] → 演示之后再做，做完重跑预跑任务。
- [连接器镜像内含不在 git 的注入数据] → 沿用 09-15 的补丁镜像方式，在旧镜像上替换编译产物。
- [每个任务启动一个 worker，开销几十毫秒] → 对 L1.5 可以忽略；以后需要时再做 worker 池。

## Migration Plan

1. 先合入代码，此时所有合约都不固定模块：行为不变，只是结果里多了 `execution: { isolation: 'none' }`，两侧哈希兼容，部署顺序无关。
2. 构建并登记失衡检测模块；给各连接器配置 `CONNECTOR_PLATFORM_CA_PUBKEY`。
3. 为药物警戒数据产品新建一份固定该模块的合约，跑一次 L1.5 任务，与同数据的 TS 结果逐字段比对，并核对界面和存证上的标注。
4. **回滚**：新建一份不固定模块的合约，任务即回到 TS 路径；或者回滚到上一版镜像。库表只是新增列，不需要回迁。

## Open Questions

- 已有合约如何加上模块固定？倾向于**新建合约**，因为合约哈希存证后内容不可变，而不是修改原合约。
- 专用算法签名密钥由 CA 签发，与根密钥分离，按 P-CTL-6 另立变更。
- 何时换 Wasmtime？倾向于在开放药企自带模块之前完成，并以此作为开放的前置条件。
