## Why

RWS 阶梯(L0–L4)的演示与 e2e 目前跑在**不合格的测试数据**上,已实测确认:

- **胰腺炎 = 0**:Synthea 无此病模块;`data/synthea/output/fhir` 现有 567 份诊断栏被行政/账单/疫苗噪声主导,糖尿病 2/567、CKD/高血压 0。
- **无药→不良反应因果**:Synthea 不建模 ADR;连接器 loader 的 `deriveAdverseEvents` **拿共病冒充不良事件**(`synthea-patient-loader.ts:130`),四格表算出的信号背后**没有任何真实关系**。
- **L0 金标准是合成占位**(`synthetic-gold-standard.ts`),准确率数字无意义。

后果:**无法演示"阶梯把一个已知信号从群体一路算到个体"**——因为数据里根本没有已知信号。

已用数值模拟**验证了替代配方合格**(scratchpad,一次性):1 万队列 + 注入胰腺炎(基础发病率 3–7% + 暴露臂 HR 2.5)+ 混杂(Z→暴露 & Z→结局)+ 编码噪声(Se≈88%)→ **两院四格全过闸(格 112–2562)、L0 Se 88.7%/Sp 98.0% ≈ 注入值、混杂可见(crude OR 2.03 > 分层 MH-OR 1.87)、错分向零衰减可见(观测 OR<注入 2.5)**。200 队列仅 13 事件、过不了闸——印证"看事件数不看人头"。

## What Changes

- **新增信号注入测试数据生成器**:Synthea 真实人口基座 + **可单测的 TS 注入层**(而非 GMF 模块——注入层精确可控 HR/Se/Sp 且可 jest 断言,GMF 据 Meeker 2022 需迭代 6 版且真值藏在 FHIR 里)。
- **注入层产出**(每患者,带 answer key 记录真值):暴露臂(降糖药 X vs 对照降糖药)、混杂协变量 Z(如胆石史,同时影响用药分配与胰腺炎风险)、真实胰腺炎状态 + 发病时间、编码后胰腺炎(按注入 Se/Sp 加噪)。
- **替换假不良事件 hack**:`deriveAdverseEvents`(共病冒充 AE)下线,连接器消费**真正注入**的不良事件。
- **L0 金标准改用注入真值**:`synthetic-gold-standard` 从"凭空造标签"改为"用注入的真实病态当金标准",L0 验证有真参照。
- **验收标准以事件数计,不以人头计**:每站点真事件数 ≥ 阈值(实测 10k 队列约 350 事件/站,充足)。**队列 = 糖尿病人**(非随机人口),生成须保证 10k 落在队列内(强制糖尿病或超量生成再筛)。
- **answer key 制品**:落一份"真值答案键"(注入的 HR / 混杂结构 / 真实病态 / Se-Sp),供 e2e 断言**管道复原了注入值**(容许错分衰减)。
- **两院切分**(华山/瑞金)保持联邦演示;**合成数据溯源标注**(顶栏警告 + 每记录标记,MUST NOT 用于监管申报,复用现有 §7.3 标签契约)。

**非 BREAKING**:仅替换测试数据来源;RWS 阶梯算法本身不变。既有 e2e 的 `describe.skip`(数据缺失时跳过)改为消费新数据。

**Non-Goals**:
- 不用 FAERS(真实信号但只 L1.5 形状、需另做集成)——除非将来要演示"真实数据上真检出信号"(登记为升级触发)。
- 不写 Synthea GMF 注入模块(注入层 TS 更短更可控,见 What Changes)。
- 不追求真实流行病学率(3–7% 胰腺炎率是拔高的,靠溯源标注兜底);测的是管道,不是流行病学。
- 不改 RWS 阶梯的任何计算逻辑。

## Capabilities

### New Capabilities
- `rws-test-data-injection`: 带已知真值的 RWS 阶梯测试数据。Synthea 基座 + TS 注入层产出暴露/混杂/结局(带时间)/编码噪声,落 answer key。数据按事件数验收、两院分列、合成溯源标注。全程只产测试数据,不入生产路径。

### Modified Capabilities
（无 spec 级修改。连接器 loader 下线 `deriveAdverseEvents`、L0 金标准改注入真值,均为**实现细节**——`data-space-connector` 主 spec 无对应 requirement,故不产 delta spec,改动列于 Impact·代码。）

## Impact

- **代码**
  - 新增 `scripts/` 或 `apps/connector/src/testdata/` 下的注入层(TS + jest 单测:断言注入 HR/Se/Sp 与产出四格/混淆矩阵一致)。
  - `apps/connector/src/domain/synthea-patient-loader.ts` — 移除/绕过 `deriveAdverseEvents`,接注入 AE。
  - `apps/connector/src/domain/algorithm-validation/synthetic-gold-standard.ts` — 改为从注入真值取金标准。
  - Synthea 基座生成配置(修正 `-m` 模块标志:糖尿病队列须真生成,当前配置产 0 糖尿病)。
  - 两院切分脚本(`split-synthea-*`)接注入后的数据。
- **治理契约(必须同步,`pnpm check:meta` 强制)**
  - `DECISIONS.md` — 登记测试数据策略决策 `D-DATA-1`(Synthea 基座 + TS 注入真值信号;弃 FAERS/GMF;理由与备选)。
  - `EVIDENCE.md` — EVD-05(L0)的 spec/enforcement 更新指向注入真值金标准;§1 说明测试数据的错分是注入的(faithful)。
  - `TRUST.md` — 合成数据溯源标注控制点确认(不得用于申报)。
  - `FLOWS.md` — 若注入层进连接器,`FLOW-RWS-05`(L0 验证链)的金标准来源 note 更新。
- **验收(DoD 以事件数计)**:两院各 ≥300 真事件;四格全过闸(n≥5);e2e 断言管道复原注入信号(L1.5 出信号、L3 分层后向真值回落、L0 Se/Sp≈注入值,均容许错分衰减);answer key 与产出对拍绿。
- **依赖/前提**:Synthea 本地 JAR(已验证 `java -jar` 可跑,免 Docker);队列规模默认 10k(验证充足),可下探但须守事件数阈值。
