## 1. 包骨架与基础设施

- [ ] 1.1 创建 `industries/power/` 目录结构（templates / sandboxes / collectors / connector-operators / analysis）
- [ ] 1.2 创建 `industries/power/package.json` 配置（包名、版本、依赖、构建脚本）
- [ ] 1.3 创建 `industries/power/tsconfig.json` TypeScript 配置
- [ ] 1.4 创建 `industries/power/src/index.ts` 导出 SPI 注册函数
- [ ] 1.5 创建 `industries/power/src/manifest.ts` 算子清单声明
- [ ] 1.6 创建 `industries/power/src/seams.ts` SPI 接缝定义
- [ ] 1.7 创建 `industries/power/README.md` 包级文档
- [ ] 1.8 配置 Jest 测试环境
- [ ] 1.9 在根 `pnpm-workspace.yaml` 中注册电力包

## 2. 电力时序数据标准格式

- [ ] 2.1 定义 `PowerTimeSeriesRecord` TypeScript 类型
- [ ] 2.2 定义 `PowerFeatures` TypeScript 类型
- [ ] 2.3 实现类型守卫函数（`isPowerTimeSeriesRecord` / `isPowerFeatures`）
- [ ] 2.4 实现数据质量检查工具（时间戳单调性、缺失值、异常值、重复记录）
- [ ] 2.5 实现数据转换工具（CSV → 标准格式 / JSON → 标准格式）
- [ ] 2.6 实现重采样工具（上采样插值 / 下采样聚合）
- [ ] 2.7 创建示例数据集（最小示例 / 完整示例 / 异常示例）
- [ ] 2.8 编写时序数据格式单元测试（覆盖率 ≥ 80%）

## 3. 负荷预测场景

- [ ] 3.1 实现 `power.feature-extraction@1.0.0` 算子（时序特征工程）
  - [ ] 3.1.1 实现统计特征提取（mean / std / max / min）
  - [ ] 3.1.2 实现周期性特征提取（hourOfDay / dayOfWeek / isWeekend）
  - [ ] 3.1.3 实现趋势特征提取（STL 分解 trend / seasonality）
  - [ ] 3.1.4 处理缺失值与边界情况
- [DEFERRED] 3.2 创建 `power.feature-extraction` 沙箱（`src/sandboxes/load-forecast-sandbox.ts`）— 沙箱推迟到 wasm 运行时方案确定后补充；`power.feature-extraction` 当前为 `system` 类纯 TS 算子
- [ ] 3.3 实现 `power.load-forecast-merge@1.0.0` 合并器
  - [ ] 3.3.1 实现多方特征聚合（按样本量加权平均）
  - [x] 3.3.2 实现预测模型（[BASELINE] 季节朴素基线，`model: "baseline"`；LSTM 推迟到接入训练后端后补充）
  - [DEFERRED] 3.3.3 实现 Transformer 预测模型（可选，初期不占位，待训练后端确定后补充）
  - [ ] 3.3.4 计算预测置信区间
  - [ ] 3.3.5 计算特征重要性
- [ ] 3.4 创建 `power.load-forecast` 收集器（`src/collectors/load-forecast-collector.ts`）
- [ ] 3.5 创建 `load-forecast` 计划模板（`src/templates/load-forecast.ts`）
  - [ ] 3.5.1 实现输入校验（必填字段、类型、取值范围）
  - [ ] 3.5.2 构建各参与方阶段链（source → feature-extraction → declassify）
  - [ ] 3.5.3 构建节点间安全聚合阶段
  - [ ] 3.5.4 构建平台合并阶段
- [ ] 3.6 编写负荷预测场景单元测试（特征提取 / 合并 / 收集器 / 模板）
- [ ] 3.7 编写负荷预测场景端到端测试

## 4. 需求响应场景

- [ ] 4.1 实现 `power.dr-potential@1.0.0` 算子（可调节负荷潜力评估）
  - [ ] 4.1.1 实现峰时可削减容量计算
  - [ ] 4.1.2 实现谷时可转移容量计算
  - [ ] 4.1.3 考虑舒适度约束
  - [ ] 4.1.4 处理边界情况（零潜力 / 满负荷 / 负荷波动）
- [ ] 4.2 实现 `power.dr-optimize@1.0.0` 优化器
  - [ ] 4.2.1 实现混合整数规划求解器（或启发式算法）
  - [ ] 4.2.2 实现削峰填谷目标函数
  - [ ] 4.2.3 实现激励预算约束
  - [ ] 4.2.4 验证方案可行性
  - [ ] 4.2.5 处理边界情况（无可行解 / 预算不足 / 单用户主导）
- [ ] 4.3 创建 `demand-response` 计划模板（`src/templates/demand-response.ts`）
  - [ ] 4.3.1 实现输入校验
  - [ ] 4.3.2 构建各参与方阶段链（source → dr-potential → declassify）
  - [ ] 4.3.3 构建平台优化阶段
- [ ] 4.4 编写需求响应场景单元测试
- [ ] 4.5 编写需求响应场景端到端测试

## 5. 窃电检测场景

- [ ] 5.1 实现 `power.anomaly-detection@1.0.0` 算子
  - [ ] 5.1.1 实现孤立森林检测算法
  - [ ] 5.1.2 实现典型窃电模式检测（零功率 / 负功率 / 功率突变 / 异常低功率）
  - [ ] 5.1.3 输出异常评分与类型
  - [ ] 5.1.4 处理边界情况（全正常 / 全异常 / 新用户冷启动）
- [ ] 5.2 创建 `power.anomaly-detection` 沙箱（`src/sandboxes/anomaly-sandbox.ts`）
- [ ] 5.3 实现 `power.theft-merge@1.0.0` 合并器
  - [ ] 5.3.1 实现跨区域异常评分聚合（加权平均 / 最大值 / 投票）
  - [ ] 5.3.2 生成 Top-K 疑似窃电用户列表
  - [ ] 5.3.3 估计区域窃电率（模糊化 ≥ 1%）
  - [ ] 5.3.4 处理边界情况
- [ ] 5.4 创建 `power.theft-detection` 收集器（`src/collectors/theft-detection-collector.ts`）
- [ ] 5.5 创建 `theft-detection` 计划模板（`src/templates/theft-detection.ts`）
  - [ ] 5.5.1 实现输入校验
  - [ ] 5.5.2 构建各供电局阶段链（source → anomaly-detection → declassify）
  - [ ] 5.5.3 构建平台聚合阶段
- [ ] 5.6 编写窃电检测场景单元测试
- [ ] 5.7 编写窃电检测场景端到端测试

## 6. 连接器侧集成

- [ ] 6.1 创建电力算子接线（`apps/connector/src/wiring/wire-power.ts`）
  - [ ] 6.1.1 注册 `power.feature-extraction` wasm 算子
  - [ ] 6.1.2 注册 `power.dr-potential` wasm 算子
  - [ ] 6.1.3 注册 `power.anomaly-detection` wasm 算子
- [ ] 6.2 实现占位训练执行器（`apps/connector/src/domain/power/mock-power-runner.ts`）
- [ ] 6.3 在 `apps/connector/src/app.module.ts` 中注册 `PowerOperatorWiring`
- [ ] 6.4 编写连接器侧集成测试

## 7. 平台侧集成

- [ ] 7.1 在 `apps/api/src/app.module.ts` 中注册电力模板（`registerPowerTemplates`）
- [ ] 7.2 在 `apps/api/src/app.module.ts` 中注册电力收集器（`registerPowerCollectors`）
- [ ] 7.3 在算子清单服务中注册电力算子
- [ ] 7.4 在通道映射中添加电力通道（`power.*` → `orchestration.channels`）
- [ ] 7.5 编写平台侧集成测试

## 8. 隐私保护验证

- [ ] 8.1 为负荷预测场景实现差分隐私测试（ε < 1.0）
- [ ] 8.2 为需求响应场景实现差分隐私测试（ε < 0.5）
- [ ] 8.3 为窃电检测场景实现差分隐私测试（ε < 2.0）
- [ ] 8.4 为所有场景实现 k-匿名测试（k ≥ 5）
- [ ] 8.5 验证小单元检查（minCell 拒绝逻辑）

## 9. 性能测试与优化

- [ ] 9.1 负荷预测性能测试（1000 用户 × 30 天 < 5 分钟）
- [ ] 9.2 需求响应性能测试（100 用户 × 24 小时 < 1 分钟）
- [ ] 9.3 窃电检测性能测试（10000 用户 × 90 天 < 10 分钟）
- [ ] 9.4 特征提取吞吐量测试（≥ 10000 条/秒）
- [ ] 9.5 资源使用测试（单阶段内存 < 4 GB，CPU < 4 核）
- [ ] 9.6 性能优化（如有瓶颈）

## 10. 文档编写

- [ ] 10.1 编写负荷预测场景文档（业务背景 / 数据格式 / 输出解释 / 使用示例）
- [ ] 10.2 编写需求响应场景文档
- [ ] 10.3 编写窃电检测场景文档
- [ ] 10.4 编写时序数据格式文档
- [ ] 10.5 编写 API 文档（计划提交 / 作业查询 / 结果获取接口）
- [ ] 10.6 编写部署文档（环境要求 / 安装步骤 / 配置说明）
- [ ] 10.7 编写算子文档（每个算子的输入输出 / 参数说明 / 使用示例）
- [ ] 10.8 更新包级 README.md（快速开始 / 目录结构 / API 参考）

## 11. 质量保证

- [ ] 11.1 运行完整测试套件（`pnpm test`）
- [ ] 11.2 运行 ESLint 静态分析（无错误）
- [ ] 11.3 运行 TypeScript 编译检查（strict mode，无错误）
- [ ] 11.4 生成测试覆盖率报告（≥ 80%）
- [ ] 11.5 运行依赖安全扫描（`pnpm audit`）
- [ ] 11.6 代码审查（随机抽查 30% 代码）
- [ ] 11.7 文档审查（完整性、准确性、可读性）

## 12. 用户验收与发布

- [ ] 12.1 端到端场景验证（三个场景各运行 3 次）
- [ ] 12.2 输出结果验证（与预期对比、可解释性）
- [ ] 12.3 文档可用性验证（按文档操作是否成功）
- [ ] 12.4 收集反馈并修复问题
- [ ] 12.5 填写验收标准检查表（`ACCEPTANCE.md`）
- [ ] 12.6 获取开发团队、质量团队、业务团队签署
- [ ] 12.7 更新 CHANGELOG.md
- [ ] 12.8 发布版本 `v1.0.0`
- [ ] 12.9 发布 release notes
