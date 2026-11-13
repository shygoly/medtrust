# Tasks

## 1. 配对队列可读展开

- [x] 1.1 扩展 `mdop-result-view`：`paired-cohort` 产出四计数可读行 + 粗率方向/无法比较摘要；缺字段回退「—」且不填 0；单测覆盖齐全与缺字段样本
- [x] 1.2 `MdopResultPanel`（或等价）渲染配对队列指标表与读表短提示；用含四计数的 C3 样本验证结果区不再仅显示「队列 n=…」

## 2. 联邦预测中文指标

- [x] 2.1 `mdopResultView` 为 `fl-prediction` 写可读摘要（轮次 + 主指标优先 AUC）；单测断言摘要含中文/可读完成度而非仅 modelType
- [x] 2.2 改写 `FlExtras`：聚合指标中文标签、各方表列可读、`modelHash` 次要；验证页面不以 `auc=… f1=…` 单行堆叠为唯一展示

## 3. 外对照注册术语注解

- [x] 3.1 增加注册术语 HELP（Estimand/Estimator、SMD、PS、EES、MCAR/MAR/MNAR）及缺失机制中文名；`registrationEffectText`/面板标签接入 title 或图例；单测覆盖机制文案映射
- [x] 3.2 `RegistrationResultPanel` 挂注解与效应可读主文案；验证 SMD/PS 相关标签有说明入口且效应不裸奔 `risk-ratio` 英文枚举

## 4. SCRI 效应解读

- [x] 4.1 Web 侧镜像 `scriRelativeIncidence`（或等价纯函数）+ 窗口人话；`mdopResultView`/`ScriExtras` 摘要含风险/对照期，分层表增加 RI/CI 或「不可估计」；单测钉住可计算与不可估计样本（对齐 API 参考值）
- [x] 4.2 接入作业详情层 A；验证有窗口与 strata 的 SCRI 作业不再仅显示「N 个分层」

## 5. 文档与回归

- [x] 5.1 更新 `DESIGN.md`：任务详情结果区补配对/FL/注册/SCRI 可读约定；验证与实现一致
- [x] 5.2 回归：相关 `*.test.ts` 全绿；抽一已有 L1.5 作业确认既有可读表无回归

## Workflow follow-up

- 归档前确认 `mdop-job-detail-display` 已归档或 `task-detail` 已进主 specs，再 archive 本 change。
- Archive after review；主规格 `task-detail` 合并本 delta 的 ADDED 需求。
