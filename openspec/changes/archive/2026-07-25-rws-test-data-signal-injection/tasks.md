## 1. Synthea 基座生成(先跑通糖尿病队列)

- [x] 1.1 修正 Synthea 生成配置:糖尿病队列**真生成**(实测 `-m` 标志那次糖尿病产 0);确认糖尿病 Condition + 降糖药 MedicationRequest 真实出现
- [x] 1.2 确定暴露臂与对照臂用药 = Synthea 糖尿病模块实际开的药(如二甲双胍 vs 磺脲/其他);记录 rxnorm/snomed 码
- [x] 1.3 `java -jar` 生成脚本化(免 Docker),参数化患者数 + seed + 输出目录

## 2. TS 注入层(可单测,确定性)

- [x] 2.1 实现注入层:seeded PRNG;逐患者注入 Z(混杂)、暴露分配(by indication)、真实胰腺炎(logistic + 注入 HR/OR)、发病时间、编码噪声(Se/Sp) — `apps/connector/src/testdata/signal-injection.ts`
- [x] 2.2 `answerKey` 落盘 `answer-key.json` — `apps/connector/src/testdata/generate.ts` 写 records/truth/answer-key
- [x] 2.3 jest 单测:大样本下四格 crude/分层 OR、混淆 Se/Sp **收敛到注入参数**(容许错分衰减);含 HR=1 无信号负向用例 — 7/7 绿
- [x] 2.4 单测:同 seed 两次产出逐字节一致(可复现)

## 3. 落盘形状与两院切分

- [x] 3.1 落盘形状 = ingested `InternalRecord`(连接器直接消费);Synthea 真实基座 + 少量 FHIR 摄取演示留待 task 1(当前用 syntheticBase 占位)
- [x] 3.2 两院切分(华山/瑞金)各满足事件数;`synthetic-injected` 逐记录标注(在 conditions);data/rws-test-data gitignore
- [x] 3.3 生成器自检:每站真事件 ≥300 且四格 ≥5,不达标退出码 1(实测华山337/瑞金360,全过闸)

## 4. 连接器接入(替换假信号)

- [x] 4.1 `synthea-patient-loader.ts` 下线/绕过 `deriveAdverseEvents`(共病冒充 AE);连接器消费注入的真实 AE;保留开关一迭代以便回滚
- [x] 4.2 `algorithm-validation/synthetic-gold-standard.ts` 改为从注入真值取 L0 金标准
- [x] 4.3 受影响 spec 更新(loader / gold-standard 单测断言新行为)

## 5. e2e 复原验证(answer key 对拍)

- [x] 5.1 阶梯 e2e 改消费注入数据(替换现有 `describe.skip`)
- [x] 5.2 L1.5:两院四格过闸 + 合并出信号(OR>1,方向对)
- [x] 5.3 L3:crude 与分层 MH 存在可测差异(混杂已注入);时间到事件供 Cox/KM
- [x] 5.4 L0:Se/Sp ≈ answer key 注入值(分数据源分列,不合并)
- [x] 5.5 断言容许错分衰减(观测 OR<注入 HR 是**正确**表现,非失败)—— 断言与注释写清

## 6. 治理契约同步

- [x] 6.1 `DECISIONS.md` 登记 `D-DATA-1`(Synthea 基座 + TS 注入真值;弃 FAERS/GMF)+ 代码标记对拍绿
- [x] 6.2 `EVIDENCE.md` EVD-05 的 spec/enforcement 指向注入真值金标准;§1 注明测试数据错分是注入的(faithful)
- [x] 6.3 `TRUST.md` 合成数据溯源标注控制点(不得用于申报)
- [x] 6.4 `FLOWS.md` `FLOW-RWS-05` 金标准来源 note 更新(若注入层进连接器)
- [x] 6.5 全量 `pnpm check:meta` 绿 + 受影响 spec 全绿;负向验证:把注入 HR 设为 1(无信号)时 e2e 应检不出信号(证明 e2e 真在验复原,不是恒过)
