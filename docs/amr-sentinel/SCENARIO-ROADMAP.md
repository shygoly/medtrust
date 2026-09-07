# AMR Sentinel — 场景续做工程路线图

> 对齐论文实验与 [`PROPOSAL.md`](./PROPOSAL.md) 差异化主张。  
> **论文正文（开发验收权威）**：[`PAPER.md`](./PAPER.md) §5 实验定义 + **§8 主张→验收映射**。  
> **数据边界**：本路线图一律以 **CHINET 先验合成 AST**（`scripts/amr/generate_synthetic.py`）为可复现主路径；**Synthea 不进入 AMR 主结果**；真实院内 WHONET/HIS 仅作外推条件。规范短文：[`DATA-DISCLAIMER.md`](./DATA-DISCLAIMER.md)。

## 论文如何指导本路线图

实现以「能否写进 [`PAPER.md`](./PAPER.md) §5 的合格句」为准：

1. **先 P0 / 实验 C**：无折点双列 ΔR%，不得宣称跨院可比已解决（PAPER §8 禁令 4）。  
2. **再 P1 / 实验 D**：无 `demo:amr-q4` 双预设回收，产品不得展示疗效话术（禁令 3）。  
3. **再 P1′ / Q3**：信号层可写进 §4.4 / 扩展结果。  
4. Q1/Q2 仅作回归，防止叙述回退。

## 已完成（基线）

| 编号 | 交付 | 命令 / 证据 |
|---|---|---|
| Q1 | 联邦耐药率 `condition-prevalence` | `pnpm --filter @medtrust/connector demo:amr-q1`；`e2e-amr-q1.spec.ts` |
| Q2 | 小细胞双院皆压（gate-then-merge 丢信号） | `pnpm --filter @medtrust/connector demo:amr-q2`；`amr-federated-q2.spec.ts` |
| **实验 C** | 折点重判读敏感性（EUCAST vs native） | `demo:amr-exp-c` / `run_exp_c_breakpoint_sens.py`；`amr-exp-c.spec.ts` |
| **实验 D / Q4** | 双预设注入效应回收 | `demo:amr-q4`；`amr` + `amr-merino` 树 |
| **Q3** | MEM×耐药标签失衡信号 | `demo:amr-q3` |
| **P2 Q2 unlock** | merge-then-gate 双院皆压解锁 | `demo:amr-q2-unlock`（需 `--q2-unlock-counts`） |
| **P2 Q5** | L0 算法外验证分列（synthetic） | `demo:amr-q5` |

当前默认路径仍为 **gate-then-merge**。`runMergeThenGate` 仅用于**同进程可信编排**（未过闸聚合不得出网）；跨网对等见 HE `runEncrypted` 或后续安全聚合。

## 优先级总序

```text
P0 折点重判读（论文实验 C）     ✅
 → P1 Q4 联邦因果（论文实验 D） ✅
 → P1′ Q3 AUD–耐药信号          ✅
 → P2 Q2 merge-then-gate / Q5   ✅（真实院外验证仍待）
```

---

## P0 — 折点可比性（CLSI vs EUCAST 重判读）

**论文锚点**：实验 C · 综述 §4.3  
**问题**：同一 MIC 在不同折点体系下 S/I/R 不同；跨院 R% 若不重判读则不可比。

### 工程切片

| 步 | 产出 | 落点 | 验收 |
|---|---|---|---|
| P0.1 | 折点表消费 API（按 organism×drug×method 查 MIC 阈值） | 复用 `data/normalized/breakpoints.parquet` + `scripts/amr/lib/mic.py` 的 `BreakpointTable`；抽公共包或 connector 侧只读加载 | 核心 5 组面板查询覆盖率 ≥ 95% |
| P0.2 | 双体系敏感性：合成株保留 `mic` + 假设「院方原判读」标签 | 生成器或后处理脚本标记 `sir_native` vs `sir_eucast` | 至少 3 个已知 CLSI≠EUCAST 组合 ΔR% ≠ 0 |
| P0.3 | 联邦 Q1 敏感性分析报告 | `demo:amr-q1-breakpoint-sens` 或扩展 Q1 demo 输出表 | 合并后报告同时给出 native / EUCAST 两套 R% 与 Δpp |
| P0.4 | 对齐契约最小字段 | 合约/任务元数据：`breakpoint_system` + `breakpoint_version` 必填 | PEP 或 admission 缺字段 fail-closed |

**明确不做（本阶段）**：分发 CLSI M100 全文；院内 LIS 全量映射 UI。

---

## P1 — Q4 联邦因果（碳青霉烯 vs BL/BLI → 30 天死亡）

**论文锚点**：实验 D · 综述 §4.5  
**问题**：经验治疗方案对 30 天全因死亡的因果效应（TTE + PSM/Cox + 跨院合并）。

### 工程切片

| 步 | 产出 | 落点 | 验收 |
|---|---|---|---|
| P1.1 | 连接器加载 T1 `episodes` / InternalRecord 含暴露与结局 | `build_amr_connectors.py` 与 `episode.py` 字段对齐 | 血培养肠杆菌目队列可筛出 |
| P1.2 | 任务规格锁定 `TteSpec`（见 PROPOSAL §7） | `apps/api` / connector RWS causal 路径 | 规格哈希进存证 |
| P1.3 | 本地因果运行时出 HR/KM | `apps/agent/.../rws_causal_runtime.py` + connector 编排 | 单院产出过闸后的效应量 |
| P1.4 | 跨院效应合并 | `causal-effect-merge.ts` | 双院合并 HR 落在 preset 带内 |
| P1.5 | `demo:amr-q4` | 仿 Q1/Q2 demo | **注入效应可回收**：`bli_noninferior` 与 `merino_superior`（`scripts/amr/priors/q4_effect.yaml`）各跑通一预设 |

**发文红线**：正文只写 *simulation recovery* 与文献效应量带对照；**禁止**写成真实疗效结论。

---

## P1′ — Q3 用药强度与耐药信号

**论文锚点**：综述 §4.4  
**问题**：抗菌药物使用强度（DDDs/100 人天）与耐药检出的 disproportionality（ROR/PRR）。

### 工程切片

| 步 | 产出 | 落点 | 验收 |
|---|---|---|---|
| P1′.1 | 合成或院侧 DDD / 暴露标记进入 records | episode 或 medications 扩展 | 暴露计数 > 0 |
| P1′.2 | `disproportionality` 分析规格下发 | 已有 `disproportionality.ts` | 单院出 ROR/PRR |
| P1′.3 | `demo:amr-q3` | connector demo | 联邦合并信号表 + 效力不足 warning（若 n 小） |

---

## P2 — 可选加强

| 项 | 说明 | 触及 | 状态 |
|---|---|---|---|
| Q2 merge-then-gate | 双院皆 `< minCell`，合并后再闸 →「联邦解锁」 | TRUST 红线 2b；FLOWS gate 注；`demo:amr-q2-unlock` | ✅ 同进程；跨网仍待 HE |
| Q5 外验证 | 闸门下分列 ValidationResult；synthetic provenance | `demo:amr-q5`；FLOW-RWS-05 | ✅ 薄 demo；真实院外验证待 |
| Q1 时间趋势 | 按季度/标本/ICU 分层 CI | 合成需时间戳密度 | 未排 |
| ClinicalAdvisor | 证据链 UI（医院 n + 文献 + 因果） | 产品层；实证后置 | 未排 |

## 明确不排入下一主线

- 基因组 WGS 主叙事  
- 纯中心化耐药预测「刷 AUC」  
- 用 **Synthea** 支撑 AMR 临床或耐药率主表  

---

## 与论文实验对照

| 论文 §5 | 工程 | 状态 |
|---|---|---|
| 实验 A 联邦 Q1 vs CHINET | Q1 demo | 已完成 |
| 实验 B Q2 小细胞 | `demo:amr-q2` + unlock | 已完成（含 P2 unlock） |
| 实验 C 折点 ΔR% | P0 / `demo:amr-exp-c` | 已完成 |
| 实验 D Q4 效应回收 | P1 / `demo:amr-q4` | 已完成 |
| Q3 / Q5 | `demo:amr-q3` / `demo:amr-q5` | 已完成（薄） |
| 安全性质（行级禁出、存证） | Q1/Q2 已覆盖 | 持续回归 |
| 真实医院外验证 | — | **下一主线条件** |

## 建议迭代节奏（工程）

1. ~~Sprint A–C / P2 合成路径~~ ✅  
2. **下一主线**：真实院 WHONET/HIS 外验证（不得用 Synthea 顶替）  
3. 跨网 merge-then-gate：HE/`runEncrypted` 或安全聚合（禁明文 ungated egress）

验收命令习惯与 Q1/Q2 一致：`demo:amr-*` + colocated `*.spec.ts` +（控制面）`e2e-amr-*.spec.ts`。
