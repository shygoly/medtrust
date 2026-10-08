# 跨院去重的发病率与罕见病登记（可信空间）

## Why

多中心真实世界研究里，同一患者常在**多家医院**留下就诊记录（转诊、复查、异地就医）。
把各院记录直接相加会**重复计数同一个人**，后果有两个，方向相反且都不轻：

- **发病率被高估**：同一患者被算两次，分子（事件）与分母（人）同时膨胀，产生虚假的地区差异与时间趋势；
- **罕见病登记被虚增**：罕见病登记最怕重复——同一个病人被两院各登记一次，会把「1 例」变成「2 例」，
  而罕见病的全部统计效力都建立在小计数上。

去重需要知道「同一人是否在多院出现」，但在数据不出域与**去标识化**前提下，没有任何一方掌握这个事实：
疾控不知道、每家医院只知道本院。跨院去重因此面临一个比 AEFI/VE 更微妙的问题——
**它不需要交换日期就能算「交集大小」，但本场景要的是并集口径的三件事**：

1. **去重后的人头数**（并集，不是交集）；
2. **人时（person-time）也必须去重**：同一患者在两院的重叠观察期**不能相加**，否则分母被灌水；
3. **事件与罕见病标志的跨院去重**（同一事件被两院记录、首次诊断取最早）。

隐私集合求交（PSI）能给「交集有多少人」，但给不出「并集的人时」与「去重后的事件计数」，
而且**交集/并集本身就在泄露行级信息**（某人是否跨院 = 交集成员资格）。MPC 可做但电路随口径变更重写、代价高；
TEE（C2）可以：各院只封最小投影（关联假名 + 观察起止 + 白名单编码），节点内按人做**观察期并集 + 事件去重**，
只出过闸聚合（C3）。

## What Changes

- 新增算子 **`rws.dedup-incidence@1.0.0`**：跨院按人**观察期并集**、事件与罕见病标志**去重**、
  逐层计数（`uniqueSubjects / personDaysUnion / eventsDeduped / rareCases`），节点内执行，
  AssemblyScript Wasm，纯数字 ABI，零能力。
- 新增 MDOP 模板 **`dedup-incidence`** 与提交入口：多家医院各 `source → seal`，节点内
  `dedup-incidence → declassify.small_cell`。
- 封装投影 `dedup-cohort`：`{linkKey, ageBand, sex, observation: {start, end}, events[{code ∈ eventCodes, date}],
  rareDisease: {code ∈ rareCodes, firstDate} | null}`；院内假名与身份标识不出机构。
- **去重口径在节点内强制**：观察期取**并集**（区间合并）、事件按 `(linkKey, 日期, 编码)` 去重、
  罕见病首次诊断取**最早日期**；口径 MUST 由模板声明，MUST NOT 由各院自行裁剪后再相加。
- 发布审查：逐层取 `(uniqueSubjects, eventsDeduped, rareCases)` 非零最小值按 minCell 判；
  **罕见病另设更严阈值**（`minCellRare`，默认 10，参数化）——罕见病小细胞即高重识别风险；整层抑制，不出合计。
- 结果：**粗发病率 = 事件数 / 人年 × 100,000**，Poisson 精确区间；
  可按年龄组给出**直接标准化率**（标准人口权重为部署参数，MUST NOT 进节点）。
- 结果解读：事实清单前置确定性结论（去重前后对比：若各院记录直接相加会是多少、去重后是多少），
  沿用结论一致性回查。
- 演示数据：`scripts/build-dedup-records.mjs` 由 Synthea 人群切片到两院，
  **注入跨院重复患者**（同一 `linkKey` 在两院各有记录、观察期部分重叠）与**注入罕见病**，
  产出两院数据与答案键（真并集人头、真人时、去重后事件数、真罕见病例数）。
- 对外物料：进入「面向真实世界研究的可信空间解决方案」deck/视频，标注合成数据与注入比例。

**本期不做**：不做真实流行病学结论；不做假名质量/连接误差的个体级评估（另立项）；
不做差分隐私保证（只有 minCell 抑制）；不做跨院生存分析（另场景）；不做地区代表性推断。

## Capabilities

### New Capabilities
- `dedup-incidence-registry`：跨院去重的发病率与罕见病登记——模板、节点内观察期并集与事件去重算子、
  最小投影封装、分层与罕见病双阈值发布审查、发病率与 Poisson 区间、去重前后对比的事实清单与解读回查。

### Modified Capabilities
<!-- 无。沿用既有 C2 链路、算子 ABI 框架与发布审查机制，不改需求。 -->

## Impact

- 代码：`packages/wasm-algorithms`（`dedup-incidence` 模块 + `dedup-incidence-model.ts` + 对拍测试 + 配方）、
  `apps/connector`（`dedup-incidence-sandbox.ts`、runner 的 `dedup-incidence@1` ABI、`seal.ts` 投影、`declassify-op.ts`）、
  `apps/api`（`plan-templates.ts`、提交入口、合并与发病率统计量、`result-interpreter/*`）、
  `apps/web`（结果页：去重前后对比、分层发病率与区间、罕见病登记表与被抑制层提示）、
  `packages/demo-scenario`（多院参与方/产品）。
- 数据：复用 `data/synthea/`（6892 人）人口基座；新增跨院重复与罕见病注入层 + 答案键（D-DATA-1 口径）。
- 部署：沿用两域拓扑与 TDX 节点；节点模块库新增 `dedup-incidence.wasm`。
- 合规：数据全合成；罕见病结果 MUST 受更严 minCell 约束并如实标注抑制；`attestationLevel` 口径不变（D9 / CTL-09）。
