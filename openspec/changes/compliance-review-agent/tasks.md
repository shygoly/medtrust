## 1. 共享判定函数（防体检/准入漂移，design D1）

- [ ] 1.1 盘点 8 条硬规则的现有判定实现：`check-meta-docs.mjs`（文档态）与 `rws-orchestrator` 准入校验（提交态），列出口径
- [ ] 1.2 抽出面向 spec 对象的共享判定函数（宿主选型见 design Open Question：倾向 `packages/` 以便 checker 亦复用），每条硬规则一个纯函数：designType/rationale、SAP 分级、缺失值成对、结局-暴露独立性、产物范围、方法在册值域、attestationLevel、L0 验证
- [ ] 1.3 共享函数单测：每条规则的通过/阻断两态
- [ ] 1.4 对拍测试：同一 spec 喂共享函数与既有准入校验，硬规则结论必一致（design D1 / spec「硬规则结论与准入一致」）

## 2. Agent 模块（照 secretflow-assistant 形，design D2/D4）

- [ ] 2.1 建 `apps/api/src/compliance-review-agent/`（controller/service/prompt/schema/module），编入 `app.module.ts`，随 medtrust-api 部署
- [ ] 2.2 service：先跑共享硬规则判定 → 组装 prompt（spec + 硬规则结果 + 相关规则文本）→ DeepSeek 单次调用出解释 + 软判断
- [ ] 2.3 zod schema 校验 LLM 返回；报告结构 = 每项 { level: pass|warn|block, reason, refs: [EVD/CTL id] } + 体检性质声明
- [ ] 2.4 软判断只产 warn 不产 block；硬规则 LLM 无权翻案（design D2 / spec「软判断只产 warn」）
- [ ] 2.5 LLM 不可用时降级：硬规则仍全出，解释/软判断标注不可用（spec「LLM 不可用时硬规则仍出」）

## 3. 出域与边界（design D5，R1/R3）

- [ ] 3.1 出域载荷断言：只送 prompt-text（spec 文本 + 硬规则结果 + 静态规则文本），不带目录真实 schema / 合约敏感内容 / 任何患者衍生数据
- [ ] 3.2 报告显式声明「提交前体检建议、非准入放行」；`block` 不阻断提交、`pass` 不豁免准入（design D3 / spec「体检判定与准入行为解耦」）
- [ ] 3.3 spec 覆盖：出域仅 prompt-text、agent block 不阻断提交、agent pass 不豁免准入

## 4. 前端（体检面板）

- [ ] 4.1 体检报告面板：pass/warn/block 三级分色（遵循 DESIGN §2 状态色 + §9 禁止清单），接在 RWS 提交表单旁作「提交前体检」
- [ ] 4.2 UI 显著区分「体检建议」与「提交准入结果」，避免误读为已放行（design D3 Risks）
- [ ] 4.3 每项报告展示引用的在册条目 id，可点开看规则原文

## 5. 治理契约同步（`pnpm check:meta` 强制）

- [ ] 5.1 `FLOWS.md` 新增 `FLOW-AI-02`（合规审查链）：`consumer→control` 提交 spec（prompt-text）→ `control→external` 送 DeepSeek（prompt-text，红线守护）→ schema 校验产出报告；dead_edge_check 成对
- [ ] 5.2 `TRUST.md` 确认 FLOW-AI-02 外部边受 CTL-11 覆盖；v1 `data-access: none` 无新增分级
- [ ] 5.3 **AGT-02 移入 `AGENT.md` §2 正册**（从 §4 平面预判移出）：`plane: control-plane` / `data-access: none` / `identity: none` / `vendor: deepseek` / `flow: FLOW-AI-02` / enforcement 指向落地符号 / spec 指向真实测试
- [ ] 5.4 全量 `node scripts/check-meta-docs.mjs` 绿；负向验证：把 AGT-02 的 flow 改为不存在的 id 应报红（R4）；把出域步 payload 改为 aggregate-only 应报红（control→external 红线）

## 6. 收敛项（可另 change）

- [ ] 6.1 准入侧（`rws-orchestrator`）重构为调用第 1 节的共享判定函数，彻底消除三处（checker/准入/agent）判定的重复实现
- [ ] 6.2 评估升级 `data-access: metadata-only`（交叉核对活合约/目录）：按 R2 持自有证书 + 读取 scope 到调用用户可见范围，重登记 AGENT.md
