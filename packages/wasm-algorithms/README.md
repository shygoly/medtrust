# packages/wasm-algorithms — 平台签名的 Wasm 算法模块

连接器上运行的算法模块源码与**入库产物**（D-CN-2 / TRUST CTL-20）。模块在连接器侧以
**零能力**方式执行：只允许导入一块由宿主提供、有上限的线性内存，没有网络、文件、进程与
系统调用能力。

## 布局

| 路径 | 作用 |
|---|---|
| `assembly/disproportionality.ts` | L1.5 失衡检测模块（ABI v1） |
| `asconfig.json` | 编译参数（`--runtime stub --importMemory --initialMemory 1 --maximumMemory 1024`） |
| `scripts/build.mjs` | 构建 → `build/disproportionality.wasm` + `build/manifest.json` |
| `scripts/check-reproducible.mjs` | 可复现性闸门：从源码重建并比对清单里的 SM3（挂进根 `pnpm test`） |
| `build/` | **入库产物**（`.wasm` / `.wat` / `manifest.json`），由 `.gitignore` 显式放行 |

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
