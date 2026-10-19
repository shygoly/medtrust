# RWD 单臂外部对照注册研究报告 Implementation Plan

> 状态：PLANNED
>
> 执行计划：[RWD 注册研究报告 Execution Plan](./2026-10-18-rwd-registration-report-execution.md)
>
> 目标：把现有模拟研究文件、Synthea 合成数据、注册型算子和证据链正式组织成一套可生成、可复核、可归档的 **RWD 单臂外部对照注册研究报告**。
>
> 数据边界：当前报告基于虚构产品 `SIM-MAB-01`、虚构适应症 `SIM-DERM-01` 和合成数据。报告封面、页眉/页脚、执行摘要、结果章节和附录必须持续标注 `SIMULATION ONLY / 非真实临床或注册结论`。

## 1. Assumptions

本计划默认：

- 报告语言为中文，关键字段保留英文代码；
- 主要读者为申办方内部方法学团队、模拟监管审阅者和平台验收人员；
- 输出格式为 `report.json`（机器事实源）、`report.html`（可打印）和 `report.docx`（正式可编辑版）；
- Markdown 作为开发期审阅格式，不作为最终唯一交付物；
- 不接入真实患者数据；
- 不将 LLM 生成的文字作为事实或数字来源；
- **AI 助手是登录后的唯一业务交互面**：研究配置、P0/SAP 确认、数据源选择、合约检查、作业提交、状态查询、报告生成和下载全部通过助手对话与卡片完成；
- 认证页是唯一例外：`chat-agent` 必须先取得平台会话，未登录用户不能被助手绕过身份闸；
- 模拟报告允许展示虚构账号和虚构密码；真实账号密码不得进入聊天消息、日志、截图或报告。

如果后续要求正式 PDF、双语或监管固定模板，再在渲染层增加，不改变事实模型。

## 2. Existing Sources of Truth

报告生成只读取以下已存在或计划扩展的权威输入：

### Study design and narrative

- [`data/synthea/registration-reference-study.json`](../../../data/synthea/registration-reference-study.json)
- [`docs/superpowers/registration-eca-simulation/README.md`](../registration-eca-simulation/README.md)
- [P0 decision record](../registration-eca-simulation/00-p0-decision-record.md)
- [Protocol](../registration-eca-simulation/01-protocol.md)
- [SAP](../registration-eca-simulation/02-sap.md)

### Synthetic cohort and answer key

- `generation-manifest.json`
- `answer-key.json`
- `data-quality-report.json`
- `trial/records.json`、`control-primary/records.json`、`control-secondary/records.json`
- 独立复核 `independent-review.json`

### Platform execution

- MDOP job、stages、fragments
- ContractBundle 与逐源 contract bindings
- TEE attestation、KMS witness、holder verification
- C3 result 与 release manifest
- execution receipts、purge receipts、chains、anchors

### Evidence

- [`registration-study-evidence.ts`](../../../industries/med/src/evidence/registration-study-evidence.ts)
- Audit evidence package ZIP
- Existing production report generators under `docs/evidence/rwd-production-single-arm-*`

现有文件只提供局部事实。报告实现不得从旧 DOCX 反推当前数字，也不得把历史生产报告中的真实机构、账号或结果复制到模拟注册报告。

## 3. Architecture

```text
study profile + protocol/SAP
  + synthetic manifest/answer key/data quality
  + independent statistical review
  + registration evidence manifest
  + MDOP job/contracts/attestations/receipts
          │
          ▼
AI assistant session + cards/tool calls
  (研究配置/P0/SAP/提交/查询/报告下载/截图索引)
          │
          ▼
strict ReportInput assembler
          │
          ▼
canonical registration-report.json
          │  deterministic renderer
          ├── report.md
          ├── report.html
          ├── charts/*.svg
          └── report.docx
          │
          ▼
report bundle ZIP
  + manifest.json (SM3 + SHA-256)
  + report fingerprint
```

### Design rules

- **Single source of truth:** 所有数字先进入 `registration-report.json`，正文不直接读取零散文件。
- **No LLM facts:** 模型只能生成已人工确认的可选讨论草稿；结果、诊断、版本、哈希和引用全部由确定性代码填充。
- **Assistant-only workflow:** 登录后不要求用户在多个业务页面之间手工跳转；每个业务动作必须在助手中以确定性卡片、工具调用和结果卡呈现。
- **Assistant is not the executor:** 助手只调用受控控制面 API；不得直接读文件、执行 shell、访问连接器原始数据或接收行级记录。
- **Synthetic first-class:** `syntheticOnly` 是必填布尔字段。为 `true` 时封面、页眉、页脚和结果章节自动带边界声明。
- **Fail closed:** 缺 study/SAP 版本、答案键、C3、合约、证明或销毁回执时不生成“成功报告”。
- **Deterministic:** 相同输入、时间和版本产生相同规范化 JSON 与相同报告摘要。
- **Traceable:** 每个结果章节都能追溯到源版本、计划哈希、算子 SM3、C3 摘要和回执。
- **No row leakage:** 报告只含聚合结果、诊断和哈希，不包含 `linkKey`、`subjectKey` 或源行。

## 3.1 AI Assistant Workflow Contract

### Authentication boundary

1. 未登录时只能进入登录页；AI 助手不提供匿名入口。
2. 模拟 E2E 使用固定的虚构演示账号和密码，登录页截图可以显示这些虚构值。
3. 真实部署的密码输入必须由原生登录控件处理；报告只显示账号/角色或 `REDACTED`，禁止把密码、access token、refresh token、Cookie、KMS key 或会话凭证写入报告。
4. 登录成功后，助手应主动打开研究注册会话，后续步骤不再要求用户进入专用表单页。

### Assistant-mediated steps

| Step | User interaction in assistant | Backend/tool action | Required screenshot |
|---|---|---|---|
| A01 | 登录并进入助手 | `auth/profile`、助手会话初始化 | 登录页、虚构账号密码、登录成功 |
| A02 | “创建 REG-ECA-001 模拟注册研究” | `draft_registration_study` | 用户消息、助手确认卡 |
| A03 | 确认 P0、方案、SAP 版本 | `validate_registration_profile` | P0/SAP 卡片 |
| A04 | 选择 trial、primary、secondary 数据源 | `resolve_registration_sources` | 数据源/合约卡 |
| A05 | 确认 estimand、协变量、缺失和敏感性 | `review_registration_plan` | 完整计划卡 |
| A06 | 生成合成数据与答案键 | `prepare_synthetic_registration` | 数据版本、答案键与质量摘要卡 |
| A07 | 提交 MDOP 作业 | `submit_external_control_registration` | 提交卡、jobId |
| A08 | 查询执行、证明、发布和销毁状态 | `get_registration_job` | 阶段/证明/回执卡 |
| A09 | 生成注册研究报告 | `build_registration_report` | 生成成功卡、报告摘要 |
| A10 | 下载 JSON/HTML/DOCX 与证据 ZIP | `download_registration_report` | 下载卡、文件清单 |

No business step is complete unless it has a screenshot and a traceable assistant message/card.

### File operations through the assistant

- Study profile, protocol and SAP are selected/uploaded through assistant file or form cards.
- The assistant displays version, digest, schema-validation result and human-confirmation state before accepting a file.
- Generated fixtures, independent-review JSON, job evidence, report files and evidence ZIP are returned as assistant cards/links.
- Direct filesystem paths are developer tooling only and are never the user-facing workflow.
- The assistant cannot read arbitrary local files; file access is limited to uploaded artifacts and registered control-plane resources.

### Screenshot and interaction manifest

Every screenshot record must contain:

```json
{
  "stepId": "A07",
  "title": "提交注册研究作业",
  "screenshot": "screenshots/A07-submit-job.png",
  "screenshotSha256": "...",
  "capturedAt": "...",
  "sessionId": "...",
  "assistantMessageId": "...",
  "cardType": "form|confirm|status|result",
  "toolName": "submit_external_control_registration",
  "toolRequestDigest": "...",
  "toolResponseDigest": "...",
  "backendResource": { "jobId": "..." },
  "credentialDisplay": "fictional-only|masked|none"
}
```

The screenshot index is part of `registration-report.json`; DOCX/HTML figure captions and numbering come from this index, not from filenames guessed by the renderer.

## 4. Canonical Report Model

新增版本化 schema，建议命名：

```text
medtrust.rwd-registration-report/v1
```

顶层字段：

| Section | Required content |
|---|---|
| `metadata` | schema、reportVersion、generatedAt、syntheticOnly、language |
| `assistantSession` | session id、user role、message/card index、tool-call index、credential-display policy |
| `screenshots` | step id、screenshot、digest、capturedAt、assistant message/card、backend resource |
| `study` | studyId、product、indication、evidenceRole、design、objective |
| `protocol` | protocolVersion/digest、SAP version/digest、P0 decision summary |
| `targetTrial` | population、strategies、time zero、follow-up、outcome、intercurrent events |
| `estimand` | ATT、summary measure、sensitivity policy |
| `sources` | role、provider、data product、contract、snapshot/projection digest |
| `cohort` | source counts、exclusions、analysis counts、strata coverage |
| `methods` | PS model、covariates、trimming、weights、missing/censoring rules |
| `result` | weighted risks、RD/RR、CI、primary/sensitivity distinction |
| `diagnostics` | SMD、overlap、weight distribution、ESS、missing、censoring |
| `sensitivity` | id、estimate、CI、direction、interpretation |
| `truthRecovery` | injected truth、adjusted/crude estimates、error and pass/fail |
| `heterogeneity` | primary vs secondary source estimates/consistency |
| `bias` | negative-control outcome、quantitative bias summary |
| `limitations` | deterministic imputation, residual confounding, synthetic boundary |
| `execution` | plan hashes、operator SM3、TEE/KMS、receipts、anchors |
| `evidence` | artifact digests、report fingerprint、manifest reference |
| `deviations` | timestamped protocol/SAP deviations and amendments |

All nested objects use strict validation. Unknown or unclassified fields fail the assembler.

## 5. Report Outline

Generated document structure:

1. Cover and synthetic-data warning
2. Document control and version table
3. AI assistant workflow and session summary
4. Executive summary with hard conclusion boundary
5. Study objectives and regulatory context
6. P0 clinical/registration decisions
7. Data sources and applicability
8. Target trial and estimand
9. Cohort construction and exclusion flow
10. Statistical methods
11. Primary results
12. Balance, overlap, weights and effective sample size
13. Missing data and censoring
14. Sensitivity analyses
15. Secondary-source reproducibility and heterogeneity
16. Negative controls and bias analysis
17. Synthetic truth recovery
18. Discussion
19. Limitations and applicability boundary
20. Reproducibility and evidence chain
21. AI interaction screenshot appendix (every A01–A10 step)
22. Appendices
    - field dictionary
    - frozen configuration
    - SAP mapping
    - artifact hashes
    - execution timeline
    - receipt and verification summary
    - report-generation manifest

## 6. Visuals

The report must include both deterministic analytical charts and every assistant
interaction screenshot:

1. cohort flow diagram;
2. propensity-score overlap distribution;
3. SMD before/after forest-style dot plot;
4. weight distribution or cumulative weight plot;
5. primary and sensitivity estimate forest plot;
6. primary vs secondary source estimate comparison;
7. A01 login screenshot with simulated credentials;
8. A02–A10 assistant conversation/card screenshots.

Charts must be deterministic SVG generated from `report.json`. Screenshots do not
establish analytical facts by themselves; every screenshot is bound to an assistant
message/card, tool call and backend object recorded in JSON.

## 7. Implementation Work Packages

### WP0 — AI assistant registration scenario

Files:

- `apps/chat-agent/src/agent/scenarios.ts`
- `apps/chat-agent/src/agent/tools/mdop.tools.ts`
- `apps/chat-agent/src/agent/tools/api-client.ts`
- `apps/chat-agent/src/cards/card-builder.ts`
- corresponding tests

Tasks:

- [ ] Add `external-control-registration` scenario and `submit_external_control_registration` tool.
- [ ] Add `draft_registration_study`, `validate_registration_profile`, `resolve_registration_sources`, `review_registration_plan`, `prepare_synthetic_registration`, `get_registration_job`, `build_registration_report` and `download_registration_report` assistant tools.
- [ ] Use deterministic form/confirm/status/result cards; the LLM must not invent IDs, hashes or results.
- [ ] Resolve data products and contracts from the directory/control plane, never hard-code sites.
- [ ] Keep all raw data and shell/file access out of the assistant.
- [ ] Test the complete assistant flow with rules fallback and model-backed modes.

### WP1 — Report contract and assembler

Files:

- `industries/med/src/reports/registration-report.ts`
- `industries/med/src/reports/registration-report.spec.ts`

Tasks:

- [ ] Define strict schema and TypeScript types.
- [ ] Assemble from study profile, fixtures, evidence manifest and job execution.
- [ ] Compute deterministic report fingerprint.
- [ ] Reject row-level or missing evidence fields.
- [ ] Test synthetic banner propagation and real-mode gates.

### WP2 — Markdown and HTML renderer

Files:

- `industries/med/src/reports/render-registration-report.ts`
- `industries/med/src/reports/render-registration-report.spec.ts`

Tasks:

- [ ] Render all canonical facts with no hard-coded result numbers.
- [ ] Add fixed document-control table and model/version mapping.
- [ ] Add synthetic warning to cover, header/footer and executive summary.
- [ ] Render missing/sensitivity/truth-recovery sections explicitly.
- [ ] Escape all text and reject non-finite numbers.
- [ ] Generate deterministic HTML and Markdown.

### WP3 — CLI generator

Files:

- `scripts/build-rwd-registration-report.mjs`
- fixture under `scripts/test/fixtures/registration-report/`

CLI:

```bash
pnpm build:rwd-registration-report \
  --fixtures data/synthea/registration-20261017/fixtures \
  --study data/synthea/registration-reference-study.json \
  --execution /path/to/job-evidence.json \
  --out docs/evidence/rwd-registration-simulation
```

Tasks:

- [ ] Support `--json-only`, `--html-only`, `--docx`.
- [ ] Emit `registration-report.json`, `report.md`, `report.html`.
- [ ] Emit chart SVGs and `report-manifest.json`.
- [ ] Require the A01–A10 assistant screenshot manifest.
- [ ] Fail when the study is synthetic but the answer key or independent review is missing.
- [ ] Return non-zero on report fingerprint drift.

### WP3A — Playwright assistant walkthrough and screenshots

Files:

- `apps/chat-agent/test/e2e/scenarios/rwd-registration-report.spec.ts`
- `apps/chat-agent/test/e2e/scenarios/QUICK-START.md`

Tasks:

- [ ] Start at the real login page and capture the simulated account/password before submission.
- [ ] After login, perform every business step only through `/space/assistant`.
- [ ] Capture A01–A10 screenshots at 1920×1080, scrolling fixed console containers before capture.
- [ ] Capture assistant messages, cards, job status, report card and download card.
- [ ] Record screenshot SHA-256, session ID, message ID, tool call and backend IDs.
- [ ] Assert that no page under `/space/tasks/new/registration` is required by the happy path.

### WP4 — DOCX and print QA

Use the bundled documents runtime and rendering workflow; do not install a local Office/LaTeX dependency.

Tasks:

- [ ] Generate `RWD单臂外部对照注册研究报告（模拟）.docx`.
- [ ] Add stable cover, TOC, headers, footers, page numbers and synthetic watermark/banner.
- [ ] Insert every A01–A10 screenshot with captions sourced from the screenshot manifest.
- [ ] Show simulated login credentials on the A01 page only; redact real credentials in any non-simulation run.
- [ ] Control table widths, long hashes, page breaks and figure captions.
- [ ] Render every page to PNG and inspect for clipping, blank pages, orphan headings and broken tables.
- [ ] Verify all report numbers against `registration-report.json`.

### WP5 — API and assistant integration

Potential API:

```text
GET /mdop/jobs/:id/registration-report?format=json|html|docx
```

Tasks:

- [ ] Only allow jobs whose `analysisType` is `external-control-registration`.
- [ ] Require the same role/contract visibility as job result access.
- [ ] Return immutable report fingerprint headers.
- [ ] Add report build/download tools to the assistant and return downloadable cards.
- [ ] Keep the existing registration form page only as debug/fallback; remove it from the normal report workflow/navigation or redirect users to the assistant.
- [ ] Keep “SYNTHETIC / 模拟报告” visible in every assistant download label and artifact filename.

### WP6 — Evidence ZIP extension

Tasks:

- [ ] Extend the evidence package with `registration-report.json`, `report.html`, `report.docx`, chart SVGs and `report-manifest.json`.
- [ ] Include source protocol/SAP versions and hashes.
- [ ] Include contract, TEE, KMS, receipt and chain summaries.
- [ ] Add per-file SM3 and SHA-256.
- [ ] Add reproducible offline verification instructions.

## 8. Test Strategy

### Unit

- strict schema rejects unknown or row-level fields;
- deterministic fingerprint;
- every report result equals canonical JSON;
- synthetic banner cannot be disabled;
- missing sensitivity/truth recovery fails in synthetic mode;
- real mode with incomplete P0/SAP fails;
- no `linkKey` or `subjectKey` appears in rendered output.

### Golden

- freeze a small synthetic fixture;
- compare canonical JSON, Markdown, HTML and chart SVG snapshots;
- change one input field and confirm only expected sections/fingerprint change.

### Cross-implementation

- TypeScript/WASM estimate equals Python independent estimate within tolerance;
- report displays both and marks discrepancies;
- intentionally corrupt the answer key and confirm report fails or marks the truth recovery as failed.

### Security

- report cannot be generated from raw source rows;
- ContractBundle non-active/expired/revoked blocks report;
- missing TEE witness or purge receipt blocks the final evidence bundle;
- minCell/release policy is visible and traceable.
- real passwords, bearer tokens, cookies and KMS keys are rejected by the report schema;
- simulated credentials are allowed only when `syntheticOnly=true` and `credentialDisplay=fictional-only`;
- every screenshot must resolve to a recorded assistant message/card and screenshot digest.

### Document QA

- DOCX render every page to PNG;
- no clipped tables, missing fonts, broken hashes or overflowing charts;
- figure captions and numbering continuous;
- synthetic warning visible on every major section boundary and at least each page footer.

## 9. Acceptance Criteria

- [ ] One command generates JSON, Markdown, HTML, SVG figures and DOCX from fixed synthetic inputs.
- [ ] Two runs with identical inputs and timestamps produce identical canonical JSON and report fingerprint.
- [ ] Every numeric statement in prose matches `registration-report.json`.
- [ ] The report contains primary, sensitivity, heterogeneity, truth-recovery and bias sections.
- [ ] The report contains P0, protocol, SAP, data-source and ContractBundle traceability.
- [ ] The report includes execution attestation, receipts, purge and chain status.
- [ ] The report never exposes a row-level identifier or source row.
- [ ] Synthetic-only warning appears prominently on cover and throughout the document.
- [ ] The evidence ZIP is offline-verifiable and contains the report fingerprint.
- [ ] The generated DOCX passes visual page-by-page QA.
- [ ] The happy path uses AI assistant cards for every post-login business step.
- [ ] A01–A10 screenshots all appear in the report with continuous figure numbering.
- [ ] The login screenshot shows simulated credentials only; real credentials cannot enter the report.

## 10. Non-Goals

- 不生成真实产品疗效或安全性结论；
- 不替代临床、统计、伦理或监管审批；
- 不把合成数据结果描述为注册成功概率；
- 不允许 LLM 自由补写缺失数字；
- 不在第一阶段生成 HMA/CDISC SDTM/ADaM 提交包；
- 不把历史生产链路报告中的真实机构或账号带入模拟报告；
- 不在报告或聊天记录中保存真实密码、令牌、Cookie 或密钥。

## 11. Risks and Controls

| Risk | Control |
|---|---|
| 正文数字与 C3 漂移 | 只从 canonical JSON 渲染，黄金测试逐字段对拍 |
| Python/TS/WASM 结果不一致 | 双实现对拍；超容差时报告标记失败 |
| 合成数据被误读为临床结论 | 封面、页眉/页脚、执行摘要和结果章节固定边界声明 |
| DOCX 表格/图裁切 | 每页 PNG 渲染 QA，固定列宽和哈希换行规则 |
| 证据包只含漂亮报告、不含底层证据 | ZIP 同时包含结果、配置、合约、证明、回执和 manifest |
| 研究方案事后修改 | versions、digests、timestamped deviations 进入报告模型 |
| 真实项目误用模拟审批 | 新 studyId/profile 和真实 P0 门必须重新确认，禁止继承模拟状态 |
| 助手编造工具结果或研究参数 | 助手只渲染确定性卡片/工具返回；ID、哈希、数字和状态由后端填充 |
| 截图中出现真实密码或令牌 | 模拟凭据必须带 fictional 标记；真实凭据遮断并由 schema/测试拒绝 |
| 截图与步骤无法对应 | screenshot manifest 绑定 step、message、card、tool call、digest 和 backend resource |

## 12. Suggested Delivery Order

1. WP0 AI assistant scenario and tools.
2. WP1 report contract + small fixture.
3. WP2 JSON/Markdown/HTML.
4. WP3 CLI + golden tests.
5. WP3A assistant-only screenshot walkthrough.
6. WP4 DOCX and visual QA.
7. WP5 API/assistant report download.
8. WP6 evidence ZIP.
9. End-to-end fixed-seed rerun and final report review.

The first implementation milestone should stop after a complete **synthetic** report is generated and visually reviewed; real-data adapters remain out of scope.
