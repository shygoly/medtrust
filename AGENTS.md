# AGENTS.md — MedTrust 入口指针（Source of Truth）

> **本文件是入口指针，不复制元语内容**（FR-8）。六本核心元语（根目录）是各域唯一权威：
> [`ARCHITECTURE.md`](ARCHITECTURE.md)（分层与双平面）· [`DESIGN.md`](DESIGN.md)（UI 规范）·
> [`DOMAIN.md`](DOMAIN.md)（领域本体）· [`FLOWS.md`](FLOWS.md)（流程契约）·
> [`DECISIONS.md`](DECISIONS.md)（决策登记册）· [`DEPLOY.md`](DEPLOY.md)（端口/env）。
> **另有自建元语**：[`AGENT.md`](AGENT.md)（智能体治理 R1-R4）· [`TRUST.md`](TRUST.md)（信任与出域闸）·
> [`EVIDENCE.md`](EVIDENCE.md)（证据效度）· [`REGULATORY.md`](REGULATORY.md)（监管路径与合规资格 REG-x）。
> **三册分工（勿混）**：TRUST 管**数据可信**（泄露/重识别）· EVIDENCE 管**结论可信**（偏倚/选择性报告）·
> REGULATORY 管**合规资格**（电子记录/GxP/CDISC/路径前提）——EVIDENCE 全绿仍可能 REG 全红。
> **ASFAS 条件元语**：[`AGENT-OPS.md`](AGENT-OPS.md)（coding agent 动作治理：分级/禁令/血缘/护栏）。
> 与旧文档冲突以元语为准，冲突时停下说明，不要悄悄改。
> 校验：`pnpm check:meta`（自有合规）+ `pnpm governance`（工厂 schema 对拍）
> + `pnpm governance:negative`（**工厂校验器本身的负向验证**：注入违规须报红、回滚须转绿），
> 连同专用守护（`check:trace` / `check:errors` / `check:tee` / `check:crypto`）全部挂在 `pnpm test` 里，
> 各自另带负例自检——**不跑的守护等于没有守护**。
> 命令与守护的清单**以 `package.json` 的 `test` 链为准**（不在此列举数量：写数字的文档注定漂移）。

---

<!-- tokencrusher session logging disabled by user request 2026-08-15；
     2026-08-26 全局停用时清理残留。原内容为 skills/tokencrusher/SKILL.md 的导入，
     以及"每次回复末尾必须运行 tokencrusher log"的强制规则。需恢复见 git history。 -->
