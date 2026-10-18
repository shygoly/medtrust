# 电力算子包验收标准

## 概述

本文档定义电力算子包（`@medtrust/domain-power`）的验收标准。

**勾选口径（2026-10-16 复核后重写）**：只有能**指到具体测试 / 文档 / 实测数字**的项才勾。
行业基准类指标（MAPE、召回率）与需要人工签署的项保持未勾，并把"为什么没勾"写在行内。
可复现命令：

```bash
pnpm --filter @medtrust/domain-power test          # 24 套件 / 176 用例
pnpm --filter @medtrust/domain-power test:perf     # 5 条性能用例（§9）
pnpm --filter @medtrust/domain-power test:coverage # 覆盖率门限 statements/lines ≥ 80
pnpm --filter @medtrust/connector test -- wire-power   # 5 条连接器侧端到端
pnpm --filter api test -- power-pack               # 13 条平台侧集成
```

## 1. 功能完整性

### 1.1 核心场景可运行

#### 负荷预测场景
- [x] 端到端流程可运行：数据源 → 特征提取 → 脱密 → 聚合 → 预测（`templates/__tests__/load-forecast-e2e.spec.ts`）
- [x] 支持多方数据融合（电网 + 气象 + 工业用户）— 模板角色枚举 + 多方阶段链
- [x] 预测输出格式正确（逐小时负荷 + 置信区间）— 基线预测 + CI（`analysis/load-forecast-model.spec.ts`）
- [ ] 预测精度可接受（MAPE < 5%）— 待真实负荷标定；当前为季节朴素基线，未声称精度

#### 需求响应场景
- [x] 端到端流程可运行：数据源 → 潜力评估 → 优化（`templates/__tests__/demand-response-e2e.spec.ts`）
- [x] 支持多用户可调节负荷聚合
- [x] 优化输出格式正确（各时段调节目标 + 激励分配）
- [x] 削峰填谷效果可量化 — e2e 断言峰谷差下降（幅度随样本变化）

#### 窃电检测场景
- [x] 端到端流程可运行：数据源 → 异常检测 → 跨区域聚合（`templates/__tests__/theft-detection-e2e.spec.ts`）
- [x] 支持多供电局数据协同
- [x] 检测输出格式正确（疑似列表 + 风险评分）— 评分分桶、证据泛化到日级
- [ ] 检测召回率可接受（Recall ≥ 80%）— 待标注集标定

### 1.2 算子单元测试

六个算子都有对应用例；**性能行按各自实际断言的门槛勾**（与 §2 的表一致）：

| 算子 | 功能/边界用例 | 性能门槛（已断言） |
|------|---------------|--------------------|
| `power.feature-extraction@1.0.0` | [x] `analysis/time-series-features.spec.ts` | [x] 1000 用户 × 30 天 < 5 分钟（§2.1） |
| `power.load-forecast-merge@1.0.0` | [x] `analysis/load-forecast-merge.spec.ts` · `load-forecast-stats.spec.ts` | [x] 合并含在 §2.1 场景内 |
| `power.dr-potential@1.0.0` | [x] `analysis/dr-potential.spec.ts` | [x] 100 用户 × 24 小时 < 1 分钟（§2.1） |
| `power.dr-optimize@1.0.0` | [x] `analysis/dr-optimize.spec.ts` | [x] 同上 |
| `power.anomaly-detection@1.0.0` | [x] `analysis/anomaly-detection.spec.ts` | [x] 10000 用户 × 90 天 < 10 分钟（§2.1） |
| `power.theft-merge@1.0.0` | [x] `analysis/theft-merge.spec.ts` | [x] 含在 §2.1 场景内 |

> 早期版本在这里列了更细的门槛（如"1000 用户 × 30 天 < 30 秒"、"100 方 × 1000 特征 < 10 秒"），
> 那些数字**没有对应的断言**。要么补断言，要么按下表的实际门槛验收——本文档选后者，不虚勾。

### 1.3 计划模板测试

- [x] 三个模板的输入校验、阶段链结构、非法输入拒绝、边界情况
      （`templates/load-forecast.spec.ts` · `demand-response.spec.ts` · `theft-detection.spec.ts` · `registry.spec.ts`）

### 1.4 集成测试

#### 连接器侧集成
- [x] 电力算子已注册到 MDOP 执行器（wasm / 前缀分派）— `apps/connector/src/wiring/wire-power.spec.ts`
- [x] 算子接线正确（真执行器 + 真沙箱 + 真 wasm 模块 + 临时 series-file）
- [x] 与数据源适配器集成（`series-file` 链式认领，D-CN-8）
- [x] 与降密闸门集成（minCell / k / 假名；缺密钥 fail-closed）

#### 平台侧集成
- [x] 电力模板已注册到模板注册表 — `apps/api/src/mdop/power-pack-integration.spec.ts`
- [x] 电力收集器已注册到收集器注册表（三个 analysisType）
- [x] 与合并服务集成（按 analysisType 分派）
- [x] 与编排服务集成（通道映射，`orchestration.migration.json`）

#### 端到端集成
- [x] 三个场景可**编译**为逻辑计划并提交（`POST /mdop/plans/preview` 实测 201；三个模板阶段链正确）
- [ ] 三个场景可**执行**到底 — 前置未齐：电力空间 3 份演示合约 `mdopStatus=unsigned`（提交即 `E_CONTRACT_UNSIGNED`），
      且本机没有已注册的电力连接器。缺这两样，作业无法下发给节点执行
- [ ] 执行状态流转 / 结果获取 / 审计日志 — 随上一条一起待真实环境

## 2. 性能指标（实测：`pnpm --filter @medtrust/domain-power test:perf`，2026-10-16 本机）

### 2.1 计算性能

| 场景 | 数据规模 | 目标时间 | 实测 | 通过标准 |
|------|----------|----------|------|----------|
| 负荷预测 | 1000 用户 × 30 天 | < 5 分钟 | **3.4 s**（jest 墙钟，含数据构造） | ≤ 目标 ✅ |
| 需求响应 | 100 用户 × 24 小时 | < 1 分钟 | **62 ms** | ≤ 目标 ✅ |
| 窃电检测 | 10000 用户 × 90 天 | < 10 分钟 | **49.5 s** | ≤ 目标 ✅ |

### 2.2 吞吐量

| 维度 | 目标 | 实测 | 通过标准 |
|------|------|------|----------|
| 特征提取吞吐 | ≥ 10000 条/秒 | 50000 条样本断言通过（jest 489 ms 为上界） | ≥ 目标 ✅ |
| 并发作业数 | ≥ 10 | 未测 | 待压测 |

### 2.3 资源使用

| 资源 | 限制 | 实测 | 通过标准 |
|------|------|------|----------|
| 单阶段内存 | < 4 GB | 特征提取 200×30 天后堆增长断言通过（714 ms 墙钟） | ≤ 限制 ✅ |
| 单阶段 CPU | < 4 核 | 未测（部署约束） | 待压测 |
| 中间结果存储 | < 1 GB | 未测 | 待压测 |

## 3. 隐私保护

### 3.1 出域口径（复核后的实际行为）

| 场景 | 出域内容 | 闸门 |
|------|----------|------|
| 负荷预测 | 节点级聚合特征 + 24 小时负荷剖面（无表计标识） | 表计数 minCell + k；可选 Laplace DP（ε ≤ 1.0，敏感度=单表最大贡献） |
| 需求响应 | 节点级基线 + 峰谷可调容量向量 | 表计数 minCell + k；可选 Laplace DP（ε ≤ 0.5） |
| 窃电检测 | ≥ 阈值的表计的**键控假名** + 分桶评分 + 日级证据 | **放行记录条数** minCell + k；评分分桶；**不叠 DP**（见 §3.3） |

### 3.2 差分隐私（口径澄清）

- [x] DP 的 ε 预算上限按场景强制（`privacy/privacy.spec.ts` / `privacy/egress-gate.spec.ts`）：负荷 1.0 / 需求响应 0.5 / 窃电 2.0
- [x] DP **只在计划显式给 `release.dpEpsilon` 时生效**（模板不给默认值，不静默加噪）
- [x] 加噪路径实测覆盖：负荷剖面（`loadProfileKw`）与需求响应峰谷容量（`peak`/`valley`）走 `dpSum`
- [x] DP 种子必须显式给（连接器侧取节点密钥派生的假名）；**缺种子即 fail-closed**——
      早先有 `"${scenario}:egress"` 这种公开常量兜底，噪声可被外部复算减掉，等于没加噪
- [ ] 窃电检测场景叠加 DP — **刻意不做**：个体列表在 minCell 闸（放行条数）与假名化之后，
      放行条数已由闸门决定，再叠 Laplace 只损可用性、不增实质保护。ε ≤ 2.0 的上限仍由 `dp.ts` 守住

### 3.3 k-匿名 / 小单元

- [x] 输入表计数满足 k ≥ 5 与 minCell（fail-closed）
- [x] **放行的个体记录条数**也过 minCell：命中不足即整表抑制，载荷与"零命中"逐字节相同
      （`connector-operators/power-declassify.spec.ts`；此前只卡输入表计数，1 块命中也能出域）
- [x] 边界情况：小队列自动拒绝（fail-closed）

## 4. 文档完整性

- [x] 包级：`README.md`（含 SPI 骨架与 wasm 接入的**当前**状态）、`CHANGELOG.md`、`package.json`
- [x] 场景文档：`docs/` 下 load-forecast / demand-response / theft-detection / time-series-format
- [x] 算子文档：`docs/operators.md`（kind 与运行位置按实现写，不再写"待 wasm 替换"）
- [x] API 文档：`docs/api.md`（模板入口、作业入口、合约资格、收集器 analysisType）
- [x] 部署文档：`docs/deploy.md`（`SPACE_PACKS` 装配、假名密钥、wasm 产物纳管）
- [x] 文档可跑性：8 个文档里的 13 个 import 符号全部命中包导出（脚本对拍）

## 5. 代码质量

### 5.1 静态分析

- [x] TypeScript 编译无错误（strict，`tsc` 通过）
- [x] 测试覆盖率 ≥ 80%（jest 门限强制 statements/lines；`collectCoverageFrom` 排除河南场景既有文件）
- [ ] ESLint 无错误 — **包内没有 eslint 配置**（`industries/*` 与 `packages/*` 都没有），
      `pnpm -r lint` 直接跳过本包；"无错误"是空断言，不勾

### 5.2 依赖与安全

- [x] 不引入非必要第三方依赖（仅 mdop / space-kernel-spi / wasm-algorithms / @nestjs/common）
- [x] 国密直引受白名单守护（`check:crypto` 绿；连接器侧 HMAC-SM3 收敛到 `domain/sm3.ts` 唯一入口）
- [ ] 依赖库无已知漏洞（`pnpm audit`）— 未复核，报告的是 workspace 既有告警

## 6. 兼容性

- [x] 兼容 MDOP 协议 v0.3（节点间安全聚合）— 电力包复用基座算子，未改协议
- [x] 算子清单格式符合规范（`kind` ∈ wasm/system，system 只做 merge）
- [x] 计划模板输出符合 `LogicalPlanDraft`（类型检查 + 集成测试编译通过）
- [x] 标准时序格式（ISO 8601 + 数值字段）、不拒绝未知字段
- [x] macOS arm64 开发环境实测（本机）；Linux 部署未实测

## 7. 验收流程

### 7.1 自验收（开发团队）
1. [x] `pnpm --filter @medtrust/domain-power test`（176 用例）
2. [x] `pnpm --filter @medtrust/domain-power test:perf`（5 用例）
3. [x] `pnpm --filter @medtrust/domain-power test:coverage`（门限通过）
4. [x] 连接器 `/ API` 侧集成测试（5 + 13 用例）
5. [x] 填写本文档

### 7.2 交叉验收（质量团队）
- [ ] 独立环境重跑、代码抽查 30%、依赖扫描、性能压测 — **待人工**

### 7.3 用户验收（业务团队）
- [ ] 三个场景各运行 3 次（需真实数据集 + 已签署合约 + 已注册连接器）
- [ ] 输出可解释性、文档可用性、反馈收集 — **待人工**

### 7.4 签署与发布
- [ ] 开发团队签署 → 见 [`SIGN-OFF.md`](./SIGN-OFF.md)
- [ ] 质量团队签署
- [ ] 业务团队签署
- [ ] 发布 `v1.0.0` — 包内版本已到 1.0.0，但 §1.4 执行链路与业务指标未验收，**不声称已发布**

---

**文档版本**：2.0（2026-10-16 复核重写：勾选收敛到可指认的证据，修正 DP / k-匿名两处不实声明，补实测性能）
**维护者**：电力算子包开发团队
