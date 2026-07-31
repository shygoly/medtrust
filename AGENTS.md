# AGENTS.md — MedTrust 入口指针（Source of Truth）

> **本文件是入口指针，不复制元语内容**（FR-8）。六本核心元语（根目录）是各域唯一权威：
> [`ARCHITECTURE.md`](ARCHITECTURE.md)（分层与双平面）· [`DESIGN.md`](DESIGN.md)（UI 规范）·
> [`DOMAIN.md`](DOMAIN.md)（领域本体）· [`FLOWS.md`](FLOWS.md)（流程契约）·
> [`DECISIONS.md`](DECISIONS.md)（决策登记册）· [`DEPLOY.md`](DEPLOY.md)（端口/env）。
> **另有自建元语**：[`AGENT.md`](AGENT.md)（智能体治理 R1-R4）· [`TRUST.md`](TRUST.md)（信任与出域闸）·
> [`EVIDENCE.md`](EVIDENCE.md)（证据效度）。
> **ASFAS 条件元语**：[`AGENT-OPS.md`](AGENT-OPS.md)（coding agent 动作治理：分级/禁令/血缘/护栏）。
> 与旧文档冲突以元语为准，冲突时停下说明，不要悄悄改。
> 校验：`pnpm check:meta`（自有合规）+ `pnpm governance`（工厂 schema 对拍），挂进 `pnpm test`。

---

@./skills/tokencrusher/SKILL.md

**CRITICAL RULE**: YOU MUST ALWAYS LOG THE SESSION AT THE VERY END OF YOUR RESPONSE.
On POSIX: npx tokencrusher log --root "$(git rev-parse --show-toplevel)" --ide opencode --task <type> --used <N> --baseline <N> --consulted <N> --avoided <N> --hits <N>
On Windows PowerShell: npx tokencrusher log --root (git rev-parse --show-toplevel) --ide opencode --task <type> ...
Do not end a conversation without running it.
