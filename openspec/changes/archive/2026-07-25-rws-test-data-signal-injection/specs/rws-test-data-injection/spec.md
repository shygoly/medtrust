## ADDED Requirements

### Requirement: 带已知真值的注入信号

测试数据 SHALL 由 Synthea 真实人口基座 + 受控注入层构成。注入层 MUST 逐患者注入:暴露臂(降糖药 X vs 对照降糖药)、混杂协变量 Z、真实结局(急性胰腺炎)状态与发病时间、编码后结局。所有注入参数(暴露真效应、混杂效应、基础发病率、编码 Se/Sp)MUST 记录于 answer key,作为管道复原的对拍基准。

注入 MUST 确定性(seeded),使同一 seed 产出可复现的数据与 answer key。

#### Scenario: answer key 记录全部注入真值
- **WHEN** 生成一份注入数据集
- **THEN** 系统 MUST 落一份 answer key,含注入的暴露效应、混杂效应、基础发病率、编码 Se/Sp、每站点真事件数

#### Scenario: 同 seed 可复现
- **WHEN** 用同一 seed 两次生成
- **THEN** 产出的数据与 answer key MUST 逐字节一致

### Requirement: 三重偏倚结构方向正确

注入数据 SHALL 同时含三种偏倚,各喂一层阶梯,且方向 MUST 正确:
- **信号**(L1.5/L2):暴露臂真实胰腺炎率高于对照(注入真 HR > 1)。
- **混杂**(L3):协变量 Z MUST 同时影响用药分配与结局风险(confounding by indication),使 crude 效应偏离分层调整后效应。
- **错分**(L0):编码结局按注入 Se/Sp 偏离真实结局(非差异错分)。

#### Scenario: 混杂使 crude 偏离分层
- **WHEN** 对注入数据算 crude OR 与 Z 分层 Mantel-Haenszel OR
- **THEN** 两者 MUST 存在可测差异(证明混杂已注入,L3 有可调整对象)

#### Scenario: 错分使观测效应向零衰减
- **WHEN** 用编码后结局(而非真实结局)算暴露效应
- **THEN** 观测效应 MUST 向零衰减,低于注入真 HR(非差异错分的正确表现);此衰减 MUST NOT 被判为管道错误

### Requirement: 以事件数验收,非人头

测试数据的合格 SHALL 以**每站点真事件数**衡量,非以患者总数。生成 MUST 保证队列(暴露于两种降糖药的糖尿病人)内患者数足够,使每站点真胰腺炎事件数 ≥ 阈值(默认 300),且 L1.5 四格每格 ≥ 输出闸门阈值(n≥5)。

队列 MUST 为糖尿病人;若基座为随机人口,MUST 强制糖尿病或超量生成后按队列筛选。

#### Scenario: 事件数达标且过闸
- **WHEN** 生成默认规模(10k 队列)数据
- **THEN** 每站点真胰腺炎事件数 MUST ≥ 300,且两院 L1.5 四格每格 MUST ≥ 5(过输出闸门)

#### Scenario: 队列过小被拒
- **WHEN** 生成规模使某站点事件数低于阈值(如 200 队列 → 约 13 事件)
- **THEN** 生成 MUST 报告不合格并指明事件数缺口,MUST NOT 静默产出过不了闸的数据

### Requirement: L0 金标准取自注入真值

L0 算法验证 SHALL 以**注入的真实结局状态**为金标准,而非凭空合成的占位标签。识别算法(基于编码)与注入真值比对产出混淆矩阵,其 Se/Sp MUST 与 answer key 记录的注入 Se/Sp 一致(容许抽样波动)。

#### Scenario: L0 Se/Sp 复原注入值
- **WHEN** 对注入数据跑 L0 验证
- **THEN** 产出的 Se/Sp MUST 接近 answer key 记录的注入 Se/Sp(默认 Se≈88% / Sp≈98%)

### Requirement: 合成数据溯源标注

注入测试数据 SHALL 逐记录标注为合成来源。任何基于它的结果 MUST 显著标注为合成数据、MUST NOT 用于监管申报。拔高的注入发病率(高于真实流行病学)MUST NOT 被表述为真实发病率。

#### Scenario: 结果携带合成溯源
- **WHEN** 任一阶梯任务在注入数据上出结果
- **THEN** 结果 MUST 携带合成溯源标注,报告 MUST 声明不得用于申报

### Requirement: 两院分列保持联邦形态

测试数据 SHALL 切分到两个站点(华山/瑞金),各自本地持有、本地计算。注入信号 MUST 在两站点均可检出(各站事件数达标),以支持联邦 meta 合并与 L0 分数据源分列(不合并)的演示。

#### Scenario: 两站点各自可检出信号
- **WHEN** 数据切分到华山与瑞金
- **THEN** 每站点 MUST 独立满足事件数与过闸要求,可各自产出站点级结果供中心合并/分列
