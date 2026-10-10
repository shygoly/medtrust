> **标注约定**:标 **`[writing-plans]`** 的任务为新算法 / 安全关键,建议走 `superpowers:writing-plans → executing-plans`(brainstorm→计划→TDD→评审检查点);未标的为接线 / DTO / 集成,直接 `openspec-apply-change` 按本清单推进即可。
>
> **实施顺序(OQ3 已定:L1.5 优先)**:阶段一 = 组1 基础 + 组2 L1.5(不依赖 meta,首个可发切片);阶段二 = 组3 meta + 组4 L2;阶段三 = 组5 L3;阶段四 = 组6 L4;组7 贯穿。

## 1. 基础:分析分级契约与路由

- [x] 1.1 在 `compute-task` DTO 与连接器 `types` 定义分析层级枚举(L1/L1.5/L2/L3/L4)与执行模式(A/B),任务 MUST 声明层级与模式
- [x] 1.2 扩充 `allowedArtifacts` 白名单类别(`disproportionality`/`effect_estimate`/`hazard_ratio`/`km_curve`/`meta_pooled`)+ DTO 校验
- [x] 1.3 `connector-task-runner` 按分析层级路由到对应估计量(沿用现有 rws/secretflow/fl 分发骨架)
- [x] 1.4 `usage-control` PEP:分析分级授权——合约目的/输出约束限定允许层级与产物,越界任务拒绝并审计(对应 usage-control spec 两个 scenario)

## 2. L1.5 失衡信号(模式 A)

- [x] 2.1 连接器:在现有 AE 路径上输出 drug×event 的 2×2 计数(不出个体行)
- [x] 2.2 中心:PRR / ROR / 信息成分(IC)计算,与参考实现对拍黄金用例 — **[writing-plans]**(具体指标 / 信号阈值 / PSUR 对齐需药物警戒岗确认 = OQ3-b)
- [x] 2.3 输出闸门:2×2 小单元格抑制沿用现有规则

## 3. 中心 meta 聚合器(federated-meta-analysis)

- [x] 3.1 `MetaAnalysisService`:DerSimonian-Laird 随机效应合并 β/HR/ATE + 置信区间 + 异质性 I²/τ² + 森林图数据 — **[writing-plans]**
- [x] 3.2 输入校验:含个体行则拒绝 + 审计;仅一个有效站点则不合并并返回原因
- [x] 3.3 meta 结果存证:合并方法 / 输入站点效应量指纹 / pooled 结果哈希上链(不含明文)

## 4. L2 比较研究(模式 A)

- [x] 4.1 连接器:分层 2×2(Mantel-Haenszel)与局部 logistic → β + 协方差,本地估计 — **[writing-plans]**
- [x] 4.2 中心:经 `MetaAnalysisService` 合并 pooled OR/RR(复用 3.1)
- [x] 4.3 输出闸门:效应量所依据分层样本量低于阈值则抑制该分层 — **[writing-plans]**

## 5. L3 因果推断(模式 A;Cox/PSM 落 Python agent)

- [x] 5.1 坐实连接器→agent 本地 in-TEE gRPC 调用通路(Cox/PSM 落 agent,已定;复用 secretflow 通路,数据留 TEE)
- [x] 5.2 agent:站内 PSM / IPTW → 局部 ATE + 标准误(匹配/加权全在站内) — **[writing-plans]**
- [x] 5.3 agent:局部 Cox 偏似然 → HR + 标准误;Kaplan-Meier 分箱输出 — **[writing-plans]**
- [x] 5.4 中心:Cox HR / ATE 随机效应 meta 合并(复用 3.1)
- [x] 5.5 输出闸门:生存曲线尾部最小在险数 + KM 分箱,防末段单点重识别 — **[writing-plans]**
- [x] 5.6 L3 任务 spec 增加目标试验仿真(TTE)字段:队列定义 / 时间零点 / 纳排 / 结局

## 6. L4 预测建模(模式 B;复用 FL 轨道)

- [x] 6.1 接通 `fl-prediction` 轨道端到端(XGBoost/SecureBoost/FedAvg;示范甲+示范乙 HFL)
- [x] 6.2 输出闸门:模型产物差分隐私(声明 ε 预算)+ 成员推断防护校验,未加噪则阻止出域 — **[writing-plans]**(闸门部分)
- [x] 6.3 出域指标(AUC/F1/`model_hash`)+ 存证;VFL 明确留待后续(Non-Goal)

## 7. 校验与演示

- [x] 7.1 各能力 spec 的每个 scenario → 测试用例(连接器 / agent / api 三侧)
- [x] 7.2 跨语言 e2e:示范甲+示范乙 CKD 数据跑通——L1.5/L2/L3 各一条(过闸→meta),L4 一条(FL 轨道)
- [ ] 7.3 web 控制台呈现分级结果(森林图 / 信号表 / KM 曲线)——可选
