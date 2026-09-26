# packages/wasm-algorithms — 平台签名的 Wasm 算法模块

连接器上运行的算法模块源码与**入库产物**（D-CN-2 / TRUST CTL-20）。模块在连接器侧以
**零能力**方式执行：只允许导入一块由宿主提供、有上限的线性内存，没有网络、文件、进程与
系统调用能力。

## 布局

| 路径 | 作用 |
|---|---|
| `modules/disproportionality-as/` | L1.5 失衡检测 — AssemblyScript **提交形状**源码（Tier A） |
| `modules/disproportionality-rust/` | 同一算法的 **Rust** 提交形状源码（Tier B 形态：第三方交源码、平台复现构建） |
| `Dockerfile.builder` + `build-rust.sh` | **隔离构建器**镜像：编译期是不被闸 1/闸 3 覆盖的执行点，必须关在无网络/只读/非 root 容器里 |
| `src/source-gate.ts` | **闸 0**：编译前排除 build.rs / proc-macro / .cargo runner / asc transform / npm 生命周期 |
| `asconfig.json` | AssemblyScript 编译参数（`--runtime stub --importMemory --initialMemory 1 --maximumMemory 1024`） |
| `src/` | **准入共享判定逻辑**（TypeScript，编译到 `dist/`）——见下 |
| `scripts/build.mjs` | 构建平台自研模块 → `build/*.wasm` + `build/manifest.json`（按 SM3 合并，不覆盖第三方条目） |
| `scripts/toolchains.mjs` | 锁定工具链配方（Rust / AssemblyScript）+ 语言白名单 + hermetic 环境 |
| `scripts/admission.mjs` | 闸 2：双独立构建器复现 → SM3 对拍 → 闸 1 静态校验 |
| `scripts/admit-cli.mjs` | 准入构建 CLI（控制面「构建触发」的执行体，stdout 一行 JSON） |
| `scripts/check-reproducible.mjs` | 可复现性闸门：从源码重建并比对清单里的 SM3（挂进根 `pnpm test`） |
| `build/` | **入库产物**（`.wasm` / `.wat` / `manifest.json`），由 `.gitignore` 显式放行 |

## `src/` —— 为什么准入逻辑要做成共享包

闸 1（静态白名单）与闸 5（吊销）的判据必须**平台侧准入**与**连接器侧执行**逐条一致。
两端各写一份实现，漂移只是时间问题，而漂移的那一刻准入闸就形同虚设 —— 所以这两块
判定逻辑放在本包里，`apps/api` 与 `apps/connector` 都 `import` 它，而不是各自复制。

| 模块 | 作用 |
|---|---|
| `src/wasm-binary.ts` | Wasm 二进制的**结构化**解析（段表 / 导入 / 导出 / 类型段）。不做 opcode 猜测 |
| `src/static-gate.ts` | **闸 1**：import 白名单、export 固定签名、拒 start/tag/GC/表/共享内存/memory64、字节与内存页上限 |
| `src/admission.ts` | 准入层级（A/B，**不设 C**）、语言白名单、状态机（不得跳闸）、合约固定条款完整性 |
| `src/output-schema.ts` | **闸 3 防外泄**：低熵输出 schema、行序不变性差分、canary 不可复原判据 |
| `src/revocation.ts` | **闸 5**：吊销名单、版本单调合并（防回放）、执行前检查 |
| `src/test-fixtures.ts` | 静态拒绝集夹具（每类违规一个负例，19 类） |

## 第三方模块准入（D-CN-5 / TRUST CTL-24）

```bash
# 闸 2：锁定工具链 + 断网 hermetic + 两个独立构建器对拍 SM3，通过才登记到 build/
node scripts/admit-cli.mjs --source modules/disproportionality-rust --analysis-type disproportionality
```

不变量：**合约固定的 SM3 必须由平台从提交源码复现产出**。于是「只交 `.wasm`」结构性地
无法入册（复现不出 SM3 → 签不了 → 固定不了），不透明第三方二进制被机制排除，而不是靠
一条政策上的拒绝。源码可在 NDA 下保密，对医院只公开 `SM3 + 平台审查背书`。

## ABI v1（小端）

```
run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32      // 0 = 成功
输入 @inOff: [included: u8[n]] [exposed: u8[n]] [events: u8[n*k]]   // 行优先
输出 @outOff: [cohortSize: u32] [a,b,c,d: u32 × k]
```

导出 `run`（函数）与 `abi_version`（常量全局，本期 = 1）。词条文本、主体标识**不进入模块**：
宿主按首次出现顺序建立词条 → 下标映射，模块只回计数。

## 构建与校验

```bash
pnpm --filter @medtrust/wasm-algorithms build               # 生成产物 + 清单
pnpm --filter @medtrust/wasm-algorithms test                # 可复现性闸门
```

编译器版本锁在 `devDependencies`（精确版本，当前 `assemblyscript@0.27.37`）。任何人用同一源码
与同一编译器版本重新构建，得到**逐字节相同**的 `.wasm`，因而同一 SM3 —— 院方可自行复现。

## 分发与信任

1. API 启动时从 `build/` 装载模块（`WASM_ALGORITHMS_DIR` 可覆盖目录），校验文件 SM3 = 清单 SM3；
2. 平台 CA 对**模块 SM3** 做 SM2 签名（载荷 `medtrust.algorithm-module.v1:<sm3>`）；
3. 数字合约可写入「固定算法模块」条款（分析类型 → 模块 SM3），该条款计入合约哈希；
4. 连接器按 SM3 从 `GET /api/v1/connector/modules/:sm3` 取模块，运行前做**两项独立校验**
   （SM3 = 合约固定值；签名可用部署配置固定的平台 CA 公钥验过），失败即任务失败、不回退。
