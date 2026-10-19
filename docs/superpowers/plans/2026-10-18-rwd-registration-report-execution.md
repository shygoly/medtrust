# RWD 注册研究报告 Execution Plan

> 状态：READY FOR IMPLEMENTATION
>
> 上位计划：[RWD 单臂外部对照注册研究报告 Implementation Plan](./2026-10-18-rwd-single-arm-registration-report.md)
>
> 本计划把上位计划拆成可顺序执行、可独立验证的工作包。核心约束：
> 登录后所有业务交互只通过 AI 助手；A01–A10 每步截图；真实密码/令牌永不进入报告；
> 所有模拟结果持续标注 `SIMULATION ONLY`。

## 1. Delivery Strategy

按“先契约、后执行、再文档化”的顺序推进：

```text
assistant contracts
  → report canonical schema
  → backend report API
  → JSON/Markdown/HTML renderer
  → assistant workflow cards/tools
  → Playwright screenshot walkthrough
  → DOCX render and visual QA
  → evidence ZIP
  → full end-to-end rerun
```

Each milestone must leave the repository green and usable by the next milestone.
Do not start DOCX layout until the JSON/Markdown/HTML facts are frozen.

## 2. Invariants

1. Login is the only pre-assistant screen. No anonymous assistant bypass.
2. After login, the happy path never opens `/space/tasks/new/registration`.
3. Every business step has a deterministic assistant card and screenshot.
4. The LLM never supplies study IDs, hashes, counts, estimates, contract IDs or job status.
5. The assistant only calls registered control-plane APIs.
6. Raw rows, `linkKey`, `subjectKey`, bearer tokens, cookies and KMS material never enter report JSON or screenshots.
7. Simulated login credentials may appear only when all are true:
   - `syntheticOnly=true`;
   - `credentialDisplay="fictional-only"`;
   - account/password are explicitly fictional test fixtures;
   - no production domain or real person is used.
8. Every screenshot is bound to session, message, card, tool call, backend object and digest.
9. Analytical facts come only from canonical `registration-report.json`.
10. Missing evidence, failed truth recovery, incomplete P0/SAP or missing receipts block a success report.

## 3. Milestones

## M0 — Freeze contracts and fixtures

**Goal:** establish the interfaces before parallel implementation.

Files:

- `industries/med/src/reports/registration-report.ts`
- `industries/med/src/reports/registration-report.spec.ts`
- `scripts/test/fixtures/registration-report/`

Tasks:

- [ ] Define `medtrust.rwd-registration-report/v1`.
- [ ] Define assistant session, message/card, tool-call and screenshot manifest schema.
- [ ] Define credential-display and redaction enum.
- [ ] Freeze one complete synthetic report input fixture.
- [ ] Add negative fixtures for real credentials, row data, missing receipts and incomplete SAP.

Exit gates:

- strict parser rejects unknown fields and secrets;
- fixture produces deterministic report input hash;
- no analytical renderer or DOCX work starts before this gate is green.

## M1 — Build report API and canonical assembler

**Goal:** one server-side endpoint can assemble report facts for a registration job.

API:

```text
GET /mdop/jobs/:id/registration-report?format=json
POST /mdop/jobs/:id/registration-report/build
```

Tasks:

- [ ] Verify job type is `external-control-registration`.
- [ ] Verify job result, evidence manifest, attestation and purge receipts.
- [ ] Assemble study/P0/protocol/SAP/source/result/diagnostics/sensitivity/evidence.
- [ ] Attach assistant screenshot manifest.
- [ ] Return report fingerprint and machine-readable gate failures.
- [ ] Keep all access checks equivalent to job detail access.

Exit gates:

- API tests for success, wrong job type, missing evidence, missing screenshots and secret rejection;
- repeated assembly over the same fixture is byte-stable;
- no raw source rows in response.

## M2 — JSON/Markdown/HTML renderer

**Goal:** render a complete human-readable report without DOCX dependencies.

Files:

- `industries/med/src/reports/render-registration-report.ts`
- `industries/med/src/reports/render-registration-report.spec.ts`
- `scripts/build-rwd-registration-report.mjs`

Tasks:

- [ ] Render the full report outline from the canonical model.
- [ ] Add synthetic warning to cover, headers/footers, executive summary and result sections.
- [ ] Generate cohort flow, overlap, SMD, weights, sensitivity and source comparison SVGs.
- [ ] Insert screenshot captions and numbering from the screenshot manifest.
- [ ] Emit `registration-report.json`, `report.md`, `report.html` and `report-manifest.json`.

Exit gates:

- HTML/Markdown golden tests;
- every numeric statement matches JSON;
- A01–A10 screenshots appear in order;
- report generation fails if synthetic truth recovery or independent review is absent.

## M3 — AI assistant scenario and tools

**Goal:** all post-login business steps execute through assistant cards.

Files:

- `apps/chat-agent/src/agent/scenarios.ts`
- `apps/chat-agent/src/agent/tools/mdop.tools.ts`
- `apps/chat-agent/src/agent/tools/api-client.ts`
- `apps/chat-agent/src/cards/*`

Tasks:

- [ ] Add `external-control-registration` scenario.
- [ ] Add deterministic cards for study draft, P0/SAP confirmation, source selection, plan review, synthetic preparation, submission, job status, report generation and downloads.
- [ ] Add tools:
  - `draft_registration_study`
  - `validate_registration_profile`
  - `resolve_registration_sources`
  - `review_registration_plan`
  - `prepare_synthetic_registration`
  - `submit_external_control_registration`
  - `get_registration_job`
  - `build_registration_report`
  - `download_registration_report`
- [ ] Add rules-based fallback fixtures for every card and tool.
- [ ] Make tool failures return actionable cards without losing user values.

Exit gates:

- assistant unit tests and rules fallback tests;
- no ambiguous free-text IDs;
- all cards expose backend IDs only after deterministic resolution;
- no shell/file/raw-data capabilities added to the assistant.

## M4 — Assistant-only screenshot walkthrough

**Goal:** prove the user can complete the workflow from login to report download through the assistant.

File:

- `apps/chat-agent/test/e2e/scenarios/rwd-registration-report.spec.ts`

Tasks:

- [ ] Capture A01 login page with fictional credentials.
- [ ] Capture successful login and assistant initialization.
- [ ] Capture A02–A10 assistant messages/cards.
- [ ] Scroll fixed console containers before full-page captures.
- [ ] Save screenshots under a versioned run directory.
- [ ] Generate `screenshot-manifest.json` with digests, message IDs, tool names and backend IDs.
- [ ] Assert the happy path never navigates to the dedicated registration form.

Exit gates:

- A01–A10 all present and non-empty;
- every screenshot resolves to an assistant session/message;
- credential policy passes;
- test stable at 1920×1080.

## M5 — DOCX renderer and visual QA

**Goal:** generate the formal editable report.

Tasks:

- [ ] Use the documents render workflow.
- [ ] Add cover, document control, TOC, page numbers and synthetic watermark.
- [ ] Insert A01–A10 screenshots and analytical figures.
- [ ] Handle long hashes, tables, captions and page breaks.
- [ ] Render every DOCX page to PNG.
- [ ] Review every page for clipping, blank pages, orphan headings and inconsistent numbers.

Exit gates:

- DOCX opens and renders;
- page-by-page QA complete;
- no figure or table clipping;
- all numbers and hashes match canonical JSON.

## M6 — Evidence ZIP and offline verification

**Goal:** package report and evidence into one verifiable archive.

Contents:

```text
registration-report.json
report.md
report.html
report.docx
charts/*.svg
screenshots/A01-A10.png
screenshot-manifest.json
study-profile.json
protocol.md
sap.md
answer-key.json
data-quality-report.json
independent-review.json
evidence-manifest.json
contracts.json
attestations.json
receipts.json
manifest.json
```

Tasks:

- [ ] Add per-file SM3 and SHA-256.
- [ ] Add report fingerprint and package fingerprint.
- [ ] Add offline verification instructions.
- [ ] Include contract, TEE, KMS, purge and chain summaries.
- [ ] Ensure the synthetic boundary is visible in every top-level report artifact.

Exit gates:

- ZIP contains every declared file;
- hashes match;
- tampering a file fails verification;
- report fingerprint is stable across two clean runs.

## M7 — Full acceptance run

Tasks:

- [ ] Fresh login with fictional account.
- [ ] Complete all steps through `/space/assistant`.
- [ ] Run synthetic generation with fixed seed.
- [ ] Execute registration job through control plane/TEE test harness.
- [ ] Generate report and evidence ZIP.
- [ ] Run web, API, connector, report, Python statistics and governance tests.
- [ ] Review report and all screenshots manually.

Final acceptance:

- [ ] AI assistant only after login.
- [ ] A01–A10 screenshots complete.
- [ ] Simulated account/password visible only on A01.
- [ ] No real secrets or row-level data anywhere.
- [ ] Report contains all required sections and evidence.
- [ ] DOCX visual QA passes.
- [ ] Evidence ZIP verifies offline.

## 4. Parallelization

After M0:

- Agent A: report schema + assembler/API.
- Agent B: assistant scenario/cards/tools.
- Agent C: deterministic SVG and JSON/Markdown/HTML renderer.

M3 screenshot walkthrough must wait for M1–M3 interfaces.
DOCX work must wait for frozen JSON and screenshot manifest.
Evidence ZIP must wait for DOCX and all report artifacts.

## 5. Test Commands

```bash
pnpm --filter @medtrust/domain-med test
pnpm --filter api test -- registration-report
pnpm --filter chat-agent test
pnpm --filter web test
pnpm --filter web build
python3 -m unittest discover -s scripts/statistical-reference -p 'test_*.py'
node --test scripts/build-registration-eca-fixtures.test.mjs
pnpm test
```

Playwright:

```bash
pnpm --filter chat-agent exec playwright test \
  test/e2e/scenarios/rwd-registration-report.spec.ts
```

## 6. Rollback Boundaries

- M0/M1 are additive and can be disabled by keeping the new endpoint unregistered.
- M2 renderer is pure and has no runtime side effects.
- M3 assistant scenario can be feature-flagged by scenario registration.
- M4 screenshot tests do not affect production behavior.
- M5 DOCX is a generated artifact only.
- M6 evidence ZIP extension may be reverted without changing the job or C3 result.

Do not modify existing job/C3 semantics to fit report layout. If the report needs a missing fact, add it to the canonical evidence input first.

## 7. Definition of Done

The plan is complete when a reviewer can open one DOCX and one evidence ZIP generated
from fixed synthetic inputs and verify:

1. every business step was performed through the AI assistant;
2. every A01–A10 screenshot is present;
3. only fictional login credentials are visible;
4. all report numbers match the canonical JSON;
5. P0, protocol, SAP, data sources, estimates, diagnostics, sensitivity, truth recovery and evidence are traceable;
6. the report remains explicitly synthetic and non-regulatory.
