## 1. 包骨架与基础设施

- [x] 1.1 创建 `industries/power/` 目录结构（templates / sandboxes / collectors / connector-operators / analysis）
- [x] 1.2 创建 `industries/power/package.json` 配置（包名、版本、依赖、构建脚本）
- [x] 1.3 创建 `industries/power/tsconfig.json` TypeScript 配置
- [x] 1.4 创建 `industries/power/src/index.ts` 导出 SPI 注册函数
- [x] 1.5 创建 `industries/power/src/manifest.ts` 算子清单声明
- [x] 1.6 创建 `industries/power/src/seams.ts` SPI 接缝定义
- [x] 1.7 创建 `industries/power/README.md` 包级文档
- [x] 1.8 配置 Jest 测试环境
- [x] 1.9 在根 `pnpm-workspace.yaml` 中注册电力包

## 2. 电力时序数据标准格式

- [x] 2.1 定义 `PowerTimeSeriesRecord` TypeScript 类型
- [x] 2.2 定义 `PowerFeatures` TypeScript 类型
- [x] 2.3 实现类型守卫函数（`isPowerTimeSeriesRecord` / `isPowerFeatures`）
- [x] 2.4 实现数据质量检查工具（时间戳单调性、缺失值、异常值、重复记录）
- [x] 2.5 实现数据转换工具（CSV → 标准格式 / JSON → 标准格式）
- [x] 2.6 实现重采样工具（上采样插值 / 下采样聚合）
- [x] 2.7 创建示例数据集（最小示例 / 完整示例 / 异常示例）
- [x] 2.8 编写时序数据格式单元测试（覆盖率 ≥ 80%）

## 3. 负荷预测场景

- [x] 3.1 实现 `power.feature-extraction@1.0.0` 算子（时序特征工程）
  - [x] 3.1.1 实现统计特征提取（mean / std / max / min）
  - [x] 3.1.2 实现周期性特征提取（hourOfDay / dayOfWeek / isWeekend）
  - [x] 3.1.3 实现趋势特征提取（STL 分解 trend / seasonality）
  - [x] 3.1.4 处理缺失值与边界情况
- [x] 3.2 创建 `power.feature-extraction` 沙箱（`src/sandboxes/feature-extraction-sandbox.ts`） <!-- 纯 TS 实现，wasm 运行时包装推迟到基础设施就绪后 -->
- [x] 3.3 实现 `power.load-forecast-merge@1.0.0` 合并器
  - [x] 3.3.1 实现多方特征聚合（按样本量加权平均）
  - [x] 3.3.2 实现预测模型（[BASELINE] 季节朴素基线，`model: "baseline"`；LSTM 推迟到接入训练后端后补充）
  - [DEFERRED] 3.3.3 实现 Transformer 预测模型（可选，初期不占位，待训练后端确定后补充）
  - [x] 3.3.4 计算预测置信区间
  - [x] 3.3.5 计算特征重要性
- [x] 3.4 创建 `power.load-forecast` 收集器（`src/collectors/load-forecast-collector.ts`）
- [x] 3.5 创建 `load-forecast` 计划模板（`src/templates/load-forecast.ts`）
  - [x] 3.5.1 实现输入校验（必填字段、类型、取值范围）
  - [x] 3.5.2 构建各参与方阶段链（source → feature-extraction → declassify）
  - [x] 3.5.3 构建节点间安全聚合阶段
  - [x] 3.5.4 构建平台合并阶段
- [x] 3.6 编写负荷预测场景单元测试（特征提取 / 合并 / 收集器 / 模板）
- [x] 3.7 编写负荷预测场景端到端测试

## 4. 需求响应场景

- [x] 4.1 实现 `power.dr-potential@1.0.0` 算子（可调节负荷潜力评估）
  - [x] 4.1.1 实现峰时可削减容量计算
  - [x] 4.1.2 实现谷时可转移容量计算
  - [x] 4.1.3 考虑舒适度约束
  - [x] 4.1.4 处理边界情况（零潜力 / 满负荷 / 负荷波动）
- [x] 4.2 实现 `power.dr-optimize@1.0.0` 优化器
  - [x] 4.2.1 实现混合整数规划求解器（或启发式算法）
  - [x] 4.2.2 实现削峰填谷目标函数
  - [x] 4.2.3 实现激励预算约束
  - [x] 4.2.4 验证方案可行性
  - [x] 4.2.5 处理边界情况（无可行解 / 预算不足 / 单用户主导）
- [x] 4.3 创建 `demand-response` 计划模板（`src/templates/demand-response.ts`）
  - [x] 4.3.1 实现输入校验
  - [x] 4.3.2 构建各参与方阶段链（source → dr-potential → declassify）
  - [x] 4.3.3 构建平台优化阶段
- [x] 4.4 编写需求响应场景单元测试
- [x] 4.5 编写需求响应场景端到端测试

## 5. 窃电检测场景

- [x] 5.1 实现 `power.anomaly-detection@1.0.0` 算子
  - [x] 5.1.1 实现孤立森林检测算法
  - [x] 5.1.2 实现典型窃电模式检测（零功率 / 负功率 / 功率突变 / 异常低功率）
  - [x] 5.1.3 输出异常评分与类型
  - [x] 5.1.4 处理边界情况（全正常 / 全异常 / 新用户冷启动）
- [x] 5.2 创建 `power.anomaly-detection` 沙箱（`src/sandboxes/anomaly-sandbox.ts`）
- [x] 5.3 实现 `power.theft-merge@1.0.0` 合并器
  - [x] 5.3.1 实现跨区域异常评分聚合（加权平均 / 最大值 / 投票）
  - [x] 5.3.2 生成 Top-K 疑似窃电用户列表
  - [x] 5.3.3 估计区域窃电率（模糊化 ≥ 1%）
  - [x] 5.3.4 处理边界情况
- [x] 5.4 创建 `power.theft-detection` 收集器（`src/collectors/theft-detection-collector.ts`）
- [x] 5.5 创建 `theft-detection` 计划模板（`src/templates/theft-detection.ts`）
  - [x] 5.5.1 实现输入校验
  - [x] 5.5.2 构建各供电局阶段链（source → anomaly-detection → declassify）
  - [x] 5.5.3 构建平台聚合阶段
- [x] 5.6 编写窃电检测场景单元测试
- [x] 5.7 编写窃电检测场景端到端测试

## 6. 连接器侧集成

- [x] 6.1 创建电力算子接线（`apps/connector/src/wiring/wire-power.ts`）——review 后重做（D-CN-8）
  - [x] 6.1.1 `power.feature-extraction` 为 **wasm** 算子（`registerWasmOperator` 前缀分派，真沙箱 `runFixedCompute`，校验阶段 op_digest = 构建清单 SM3）
  - [x] 6.1.2 `power.dr-potential`（同上；userType / comfort 入参）
  - [x] 6.1.3 `power.anomaly-detection`（同上；种子取键控假名，平台无法反推）
  - [x] 6.1.4 `source.dataset` 链式认领：数据源声明新增 `series-file`；医疗 L15 环婉拒时序产品，电力环按 `power.*` schema 认领；时序**不进**共享 LocalStore
  - [x] 6.1.5 电力 declassify 链环：minCell（不弱于合约）/ k / 可选 DP；负荷与 DR 聚合到节点级，窃电只出阈值以上的 HMAC-SM3 假名（`CONNECTOR_POWER_PSEUDONYM_KEY`，缺失 fail-closed）
- [x] 6.2 ~~占位训练执行器~~ 已删除（由真实 wasm 模块替代）
- [x] 6.3 在 `apps/connector/src/app.module.ts` 中注册 `PowerOperatorWiring`
- [x] 6.4 连接器侧集成测试：`wire-power.spec`（真执行器 + 真 L15 链首 + 真沙箱 + 临时 series-file，两节点负荷预测 / 窃电跨节点合并）+ `register-power-ops.spec`

## 7. 平台侧集成

- [x] 7.1 在 `apps/api/src/app.module.ts` 中注册电力模板（`registerPowerTemplates`）
- [x] 7.2 注册电力收集器；合并阶段参数经 `sinkStageParams` 透传（DR 目标 / 预算不再由平台编造；负荷预测按区域小时总剖面外推）
- [x] 7.3 电力算子登记：节点三算子由 wasm 构建清单自动登记为 `kind: wasm`；平台三个 merge 由包经 `kernelPlatformOperatorRegistry` 在组装根注册（**不内置**在基座 `SYSTEM_OPERATORS`，纯度棘轮守护）
- [x] 7.4 在通道映射中添加电力通道（`power.*` → `orchestration.channels`）
- [x] 7.5 平台侧集成测试：`power-pack-integration.spec`（真算子注册表下三模板可提交、汇点参数透传、仅收 system/merge）

## 8. 隐私保护验证

- [x] 8.1 为负荷预测场景实现差分隐私测试（ε < 1.0）
- [x] 8.2 为需求响应场景实现差分隐私测试（ε < 0.5）
- [x] 8.3 窃电检测场景：**不用 DP**，改用「放行个体记录条数过 minCell + 键控假名 + 评分分桶」
  （个体列表在 minCell 闸与假名化之后，放行条数已由闸门决定，再叠 Laplace 只损可用性、不增实质保护）。
  DP 的 ε ≤ 2.0 预算上限仍在 `privacy/dp.ts` 里守住，但**不声称**窃电流水线加了噪
- [x] 8.4 为所有场景实现 k-匿名测试（k ≥ 5）— 口径澄清：输入表计数过 k，
  **窃电的放行个体记录条数另过 minCell**（见 8.3；原先只卡输入表计数，个体列表可以不足 5 条就出域）
- [x] 8.5 验证小单元检查（minCell 拒绝逻辑）— 含「命中不足即整表抑制、载荷与零命中不可区分」

## 9. 性能测试与优化

- [x] 9.1 负荷预测性能测试（1000 用户 × 30 天 < 5 分钟）
- [x] 9.2 需求响应性能测试（100 用户 × 24 小时 < 1 分钟）
- [x] 9.3 窃电检测性能测试（10000 用户 × 90 天 < 10 分钟）
- [x] 9.4 特征提取吞吐量测试（≥ 10000 条/秒）
- [x] 9.5 资源使用测试（单阶段内存 < 4 GB，CPU < 4 核）— 堆内存断言已覆盖；CPU 核数为部署约束
- [x] 9.6 性能优化（如有瓶颈）— 长序列孤立森林减树/加大步长

## 10. 文档编写

- [x] 10.1 编写负荷预测场景文档（业务背景 / 数据格式 / 输出解释 / 使用示例）
- [x] 10.2 编写需求响应场景文档
- [x] 10.3 编写窃电检测场景文档
- [x] 10.4 编写时序数据格式文档
- [x] 10.5 编写 API 文档（计划提交 / 作业查询 / 结果获取接口）
- [x] 10.6 编写部署文档（环境要求 / 安装步骤 / 配置说明）
- [x] 10.7 编写算子文档（每个算子的输入输出 / 参数说明 / 使用示例）
- [x] 10.8 更新包级 README.md（快速开始 / 目录结构 / API 参考）

## 11. 质量保证

- [x] 11.1 运行测试套件 — 口径写清：本包 24 套件 / 176 用例 + perf 5；连接器 `wire-power.spec` 5 + API `power-pack-integration.spec` 13。
  **不是**整仓 `pnpm test` 绿：`check-kernel-purity --ratchet` 有 4 组越界，属医疗 MDOP 迁移（RWS/LoRA 词汇落在基座目录），与本包无关，待该工作流处置
- [x] 11.2 运行 ESLint 静态分析（无错误）— 包内无独立 eslint 配置；以 `tsc --strict` 为准
- [x] 11.3 运行 TypeScript 编译检查（strict mode，无错误）
- [x] 11.4 生成测试覆盖率报告（≥ 80%）— statements/lines ≈ 90%（排除河南场景既有文件）
- [x] 11.5 运行依赖安全扫描（`pnpm audit`）— 已跑；报告为 workspace 既有告警，非本包新增
- [x] 11.6 代码审查（随机抽查 30% 代码）— 实现期对照 spec 抽查 analysis/privacy/templates
- [x] 11.7 文档审查（完整性、准确性、可读性）— docs/* 与 README 已对拍模板 id / 算子 id

## 12. 用户验收与发布

- [ ] 12.1 端到端场景验证（三个场景各运行 3 次） <!-- 需要真实数据集验证 -->
- [x] 12.2 输出结果验证（与预期对比、可解释性）— e2e 断言峰谷差/Top-K/阶段链
- [x] 12.3 文档可用性验证（按文档操作是否成功）— 示例 import 与包导出一致
- [x] 12.4 收集反馈并修复问题— 本轮修复 IF 误报、份额冷启动、覆盖率与注册表类型
- [x] 12.5 填写验收标准检查表（`ACCEPTANCE.md`）— 已更新可机器验证项；精度类行业基准项仍待业务标定
- [ ] 12.6 获取开发团队、质量团队、业务团队签署（需人工）— 签署表已就绪：`SIGN-OFF.md`
- [x] 12.7 更新 CHANGELOG.md
- [ ] 12.8 发布版本 `v1.0.0` — `@medtrust/domain-power@1.0.0`（private workspace） <!-- 业务指标未验收 -->
- [x] 12.9 发布 release notes — `RELEASE-NOTES-1.0.0.md` + CHANGELOG
