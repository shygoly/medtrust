# 三场景测试与验收手册

> 配套文档：[`docs/rws-trusted-space-solution.md`](rws-trusted-space-solution.md)（方案）·
> 决策：[`DECISIONS.md`](../DECISIONS.md) `D-RWS-6`（TND 选型）/ `D-RWS-7`（去重口径与双阈值）
> **数据全为合成数据**；效应量、跨院重复比例与罕见病率均为注入，不得读作真实流行病学结论。

本手册给出**可直接复跑**的验收路径：每条都写明命令、期望输出与证据落点，便于第三方独立复核。
按顺序执行即可从零复现全部结论。

---

## 0. 环境与前置

| 项 | 要求 |
|---|---|
| Node | ≥ 20（`node -v`）；pnpm workspace（仓库根执行） |
| Java | 17（仅在需要重新生成 Synthea 基座时） |
| 合成人群基座 | `data/synthea/rws-showcase/csv/`（Synthea 7000 人；缺失时见 `data/synthea/` 生成脚本说明） |
| 构建产物 | `packages/wasm-algorithms/build/`（`manifest.json` + 6 个 `.wasm`） |
| 可选（真机） | 三台 Intel 机器按 `openspec/changes/tdx-attestation-pilot/runbook-rebuild.md` 拉起 |

```bash
pnpm install
pnpm --filter @medtrust/wasm-algorithms build     # 模块字节 + manifest（含 SM3）
```

---

## 1. 算子层验收

```bash
pnpm --filter @medtrust/wasm-algorithms test
```

**期望**

- 六个模块**逐模块重建对拍**：同源码 + 同编译器 → 同字节 → 同 SM3（漂移即红）；
- 每个模块的 TS 参考实现与夹具对拍全绿（含零格、边界日期、未排序输入等负例）；
- ABI **零能力**静态检查通过：只允许导入 `env.memory`，不得导入函数/表/全局量或调用 WASI。

**证据**：测试输出 + `packages/wasm-algorithms/build/manifest.json` 中各模块 `sm3` 与 `sizeBytes`。

| 模块 | 字节 | SM3（前 8 位） |
|---|---|---|
| `rws.ve-tnd` | 382 | `98c84695…` |
| `rws.dedup-incidence` | 1019 | `02f0f409…` |

### 1.1 三层核验与语言选择（常见质疑的口径）

**核验不依赖「读字节」，靠三层可机检机制**：
① **字节层**：可复现构建 + SM3 逐模块重建对拍 + 节点模块库按 `<sm3>.wasm` 命名准入（摘要即白名单）+ 阶段 `op_digest` 比对；
② **能力层**：Wasm 导入表静态可查——只导入 `env.memory`、零函数/零 WASI（构建期静态检查），运行时沙箱再加 ABI 白名单与内存上限；**模块没有泄露通道，最坏是算错**；
③ **语义层**：TS 参考实现差分对拍（含负例与顺序无关性）+ 答案键逐格对拍 + 输入无关的运行时不变量（违反即拒）。

**为什么不是 Rust**：核验对象是产物字节而非源码。原生 Rust 产物（ELF）证明「无网络/无文件」需 seccomp/strace 动态分析且 TCB 大得多；Wasm 的导入表把能力边界变成**静态事实**。Rust→Wasm（`wasm32-unknown-unknown`）是可行替代，上述核验链与源语言无关、切换无需改动；选 AssemblyScript 是工具链选择（字节最小 0.4–1KB + 与全仓 TS 同语言），不是安全让步。1KB 级模块亦可用 `wasm2wat` 反汇编为一页可读文本。

**谁来核验：机器强制 + 离线人审，不依赖平台账号**。三层核验全部由机器执行（CI 重建对拍、节点按摘要准入、运行期不变量），运行时无需任何人在环。真人只出现在：① 算子上架的治理审批（线下看一页 WAT + 对拍报告，签发白名单，一次性）；② 合约签署（各机构自持密钥，条款钉死摘要与阈值，部署前）；③ 结果解读复核（AI 草稿人审后发布，核的是话术不是算子）；④ 审计（拿导出回执链 + 节点公钥离线验证 `export-receipts` → `verify-receipt-chain.mjs`，对照链上锚定，无需平台账号）。平台不持密钥、只做编排与锚定——**核验若要靠登录平台看控制台，即退化为信任平台，本设计刻意避免之**。

**如实边界**：核验为经验性（差分+真值+不变量），非形式化证明；参考模型与模块为两套实现，但概念性错误理论上可能同犯——兜底是教科书口径方法 + 负例层（真 VE=0 层必须区间跨 0）+ 方向性断言；每运行字节的 RTMR 度量属后续加固。

---

## 2. 数据集验收

```bash
node scripts/build-ve-records.mjs    --synthea data/synthea/rws-showcase/csv --out data/demo/ve
node scripts/build-dedup-records.mjs --synthea data/synthea/rws-showcase/csv --out data/demo/dedup
```

**期望（关键数字）**

| 场景 | 期望 |
|---|---|
| VE | 受种者 4502 · 剂次 8955 · 检测 **1946** 条（其中同人同日重复 **34** 条）· 成人 6681 |
| 去重 | 甲院 **4038** 人 · 乙院 **3646** 人 · 注入跨院重复事件 **18** 起 · 观察期部分重叠 **663** 例 · 空 1 天 **667** 例 |

- 每条记录带 `synthetic: true` + `dataSource`；`answer-key.json` 带 `source` 与 `disclaimer`；
- 构建脚本内置自检（VE `selfCheck.pass = true`；去重 `duplicatedEvents > 0` 等）**必须为真**，否则阻断。

**证据**：`data/demo/{ve,dedup}/answer-key.json`、逐记录溯源字段。

---

## 3. 本地端到端验收（C2 → C3）

```bash
pnpm --filter @medtrust/connector demo:rws-scenarios
```

**链路**：持有方封存投影 → 节点内**真 wasm 模块**（真沙箱）→ 发布审查（`minCell` / `minCellRare`）→ C3 载荷。

**期望（场景二 · TND）**

- 检测 1946 → 投影后 **1912**（34 条重复在本地被去重）；
- 七层：真 VE=0.6 的四层估出 **74.9% / 77.6% / 60.1% / 76.5%**；
  真 VE=0 的两层 **3.3% / 1.3%**（区间跨 0）；`80+|F`（`vaccPos = 0` 且小格）**被抑制**。

**期望（场景三 · 去重）**

- 去重后 **6354 人**；**直接相加虚增人头 +19.5%~+23.3%**、**65+ 罕见病 +24.6% / +33.3%**；
- **罕见病列单独抑制**在 3 层生效（2/2/5 例 < `minCellRare = 10`），其余列照常发布；65+ 两层保留 87 / 69 例。

**判定**：C3 载荷与答案键**逐格一致**；载荷文本中**不得出现**关联假名（`lk-`）或编码文本（`94500-6`、`I21.9`、`E76.0`）。

**证据**：`openspec/changes/{vaccine-effectiveness-tnd,cross-hospital-dedup-incidence}/evidence/local-run-20261003/`（JSON + 终端日志 + README）。

---

## 4. 真机验收（TDX 客户机内）

**前置**：模块按 `<sm3>.wasm` 放进节点模块库；数据集与 harness 上传。

```bash
# 节点侧（teeA）：模块库应含 4 个按 SM3 命名的模块
ls -la /opt/medtrust/modules/

# 客户机内执行（真模块字节 + 真实 quote + 与答案键对拍）
/opt/node/bin/node run-rws-in-tdx.mjs --modules /opt/medtrust/modules --data ./data
```

**期望**

- 环境事实：`Memory Encryption Features active: Intel TDX` · `/dev/tdx_guest` 存在；
- **真实 TDX quote 5006 字节**，REPORTDATA 前 32B = `sm3(pub)`、其余置零；
- 结论行：**真机内执行结果与答案键逐格一致 ✓**（模块 vs 参考语义、参考语义 vs 答案键 两条都要 ✓）。

**节点服务验收**

```bash
systemctl is-active tee-node                 # active
journalctl -u tee-node -n 3 --no-pager       # 「可信空间节点启动：…｜清单 N 条｜探针 已配置」
```

**证据**：`pitch/rws-showcase-20261003/`（`tdx-run.log`、`screenshots/*.png`、harness）。
**边界**：本项覆盖「节点内算子在 TDX 客户机执行」；平台侧完整 C2 调度链（合约要约 → 中继 → 会话见证 →
KMS 释放 → 出域上链 → 销毁）由场景一作业 `job-murqxdaz-533a32d5` 实测，场景二/三待平台与连接器
bundle 更新到含新模板/投影/算子的版本后重发。

---

## 5. 物料验收

| 物料 | 判定 |
|---|---|
| PPT | `MedTrust-面向真实世界研究的可信空间解决方案.pptx` **17 页（业务版）**：正文 13 页讲业务（问题→方案→密文安全性→三场景→真机证据→落地），技术细节收入附录 A–D（D 含 TDX Quote 原理）；**真机截图 5 张直接嵌入正文**（场景一控制台 2 张 + 本方案 TDX 终端 3 张）；数字取自证据 JSON；每页右上角标注口径（场景一「已在 TDX 真跑」/ 场景二、三「TDX 客户机内已实测 · 平台侧 C2 调度待接通」） |
| 视频 | `pitch/rws-showcase-20261003/MedTrust-…-1080p.mp4`，1920×1080，≈6:12（旁白已改写规避多音字误读），含旁白与 BGM；旁白稿 `video/rws/narration.config.json` |
| 截图 | 3 张真机截图（TDX 客户机内实测 / 节点状态 / 推理机），均为真实运行输出 |

---

## 6. 失败处置（fail-closed 语义，不得绕过）

| 情形 | 系统行为 | 为什么 |
|---|---|---|
| 模块返回 `3` / `5` | 阶段失败并记 Observation | 输入形状 / 不变量违反，交给人工而不是给一个错数 |
| 去重模块返回 `6` | **拒**（排序契约被破坏） | 宿主未按 `(层, 主体, 起点)` 预排序时宁可拒绝，不悄悄算错 |
| 某层 `vaccPos = 0` | 该层 VE 显示「不可估计」 | MUST NOT 以 0 / 100% 代替不可估 |
| 罕见病列 `0 < n < minCellRare` | **只**抑制罕见病列并标 `rareSuppressed` | 小细胞不等于整层不可发布，但阈值不得放宽 |
| `minCellRare < minCell` | **拒** | 罕见病小细胞重识别风险更高，放宽即拒 |
| 六格合计 ≠ 该层纳入数 | **拒** | 计数契约破坏，防止静默漏算 |
| 载荷含假名 / 编码文本 | **拒** | 出域载荷只允许数字与分层键 |

---

## 7. 对外表述清单（分场景）

| 场景 | 可以怎么说 | 不可以怎么说 |
|---|---|---|
| ① AEFI/SCRI | 已在 Intel TDX 真跑：证明链 + 密钥释放 + 节点内计算 + 结果解读 + 销毁上链 | 不得表述为某疫苗的真实安全信号 |
| ② VE/TND | 节点内算子已在 TDX 客户机实测；合成人群上四层估出 60%~78%、两层负例区间跨 0、一层按约定不可估 | 不得表述为任何疫苗的真实保护效果 |
| ③ 跨院去重 | 直接相加会虚增人头约两成、65+ 罕见病登记虚增两到三成；罕见病列按更严阈值单独抑制 | 不得表述为任何地区的真实发病率或患病率 |
| 密文出域 | 可以说「密文出域是设计行为，安全靠四层：最小投影、加密与密钥分持、密钥只在远程证明通过后释放、算完即毁只出聚合」 |
| 通用 | 「明文不出院：跨机构仅密文投影与聚合出域、只出聚合、全程可复核」有机器可复核证据支撑 | 不得声称已具备真实数据接入资格（需 REG-08 合规与伦理前提）；不得声称软件证明等同硬件机密计算（`attestationLevel` 语义见 `D-RWS-4`） |
