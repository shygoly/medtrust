# rws-analytics-ladder 剩余修补(三端全绿)Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan (本环境不主动派子代理). Steps use checkbox (`- [ ]`) syntax.

**Goal:** 清掉审计发现的 3 处红,使 api / connector / agent 三端测试全绿。

**Architecture:** 均为修复/环境,非新算法。两处是 TS 测试编译错(可空断言、漏传构造参数),一处是 agent 的 pytest 无法解析 src-layout 包(补 `pythonpath`)。不改动任何被测实现逻辑。

**Tech Stack:** TypeScript + Jest(ts-jest,严格模式);Python + pytest(src 布局)。

**执行须知:** 提交仅在用户授权时进行;每步先跑测试确认 green。相关纪律:@superpowers:executing-plans、@superpowers:verification-before-completion。

---

## File Structure

- Modify: `apps/connector/src/domain/comparative-effect.spec.ts:117` — 修可空访问(测试逻辑不变)。
- Modify: `apps/connector/src/domain/connector-worker.service.spec.ts` — 补 `flRunner` 第4构造参数 + import。
- Modify: `apps/agent/pyproject.toml` — 新增 `[tool.pytest.ini_options] pythonpath=["src"]`,让 pytest 解析 `medtrust_agent`。

三处互不依赖,可独立验证。

---

## Chunk 1: 三端修补

### Task 1: 修 L2 连接器测试编译错(TS18048)

**Files:**
- Modify: `apps/connector/src/domain/comparative-effect.spec.ts:117`
- Test: 同文件

- [ ] **Step 1: 复现失败**

Run: `pnpm --filter @medtrust/connector test -- comparative-effect`
Expected: FAIL — `TS18048: 'est.mantelHaenszel' is possibly 'undefined'`(整套编译失败)。

- [ ] **Step 2: 修复(est 可空 → 非空断言)**

第117行:
```ts
    expect(est?.mantelHaenszel.or).toBeGreaterThan(0);
```
改为(该分支已保证 est 有值 —— 2 个分层):
```ts
    expect(est!.mantelHaenszel.or).toBeGreaterThan(0);
```

- [ ] **Step 3: 验证通过**

Run: `pnpm --filter @medtrust/connector test -- comparative-effect`
Expected: PASS(`effectEstimateFromStratifiedTables` describe 全绿)。

---

### Task 2: 修 connector-worker 测试 arity(缺 flRunner 第4参)

**Files:**
- Modify: `apps/connector/src/domain/connector-worker.service.spec.ts`(import + 构造调用)
- Test: 同文件

构造器签名(`connector-worker.service.ts:17`):`(controlPlane, productSource, runner, flRunner, progress)` —— 测试漏传第4个 `flRunner: FlTaskRunner`。

- [ ] **Step 1: 复现失败**

Run: `pnpm --filter @medtrust/connector test -- connector-worker.service`
Expected: FAIL — `TS2554: Expected 5 arguments, but got 4`。

- [ ] **Step 2: 加 import**(与其他 domain import 并列,顶部)

```ts
import { FlTaskRunner } from './fl-prediction/fl-task-runner';
```

- [ ] **Step 3: 加 flRunner mock**(紧接 `const progress = {...}` 之后)

```ts
    const flRunner = { run: jest.fn().mockResolvedValue(undefined) };
```

- [ ] **Step 4: 修构造调用**(把 flRunner 作为第4参,progress 顺延为第5)

```ts
    const worker = new ConnectorWorkerService(
      controlPlane as unknown as ControlPlaneClient,
      productSource as unknown as DataProductLocalSource,
      runner as unknown as ConnectorTaskRunner,
      flRunner as unknown as FlTaskRunner,
      progress as unknown as TaskProgressReporter,
    );
```

- [ ] **Step 5: 验证通过**

Run: `pnpm --filter @medtrust/connector test -- connector-worker.service`
Expected: PASS。

- [ ] **Step 6: 连接器全量回归**

Run: `pnpm --filter @medtrust/connector test`
Expected: 全部套件 PASS(0 失败),含 comparative-effect + connector-worker。

---

### Task 3: 让 agent 测试可解析包(pytest pythonpath)

**Files:**
- Modify: `apps/agent/pyproject.toml`(新增 pytest 配置段)

根因:src 布局(`packages.find where=["src"]`)+ 无 `[tool.pytest.ini_options]` → 未 editable-install 时 `import medtrust_agent` 失败(9 套收集错误)。

- [ ] **Step 1: 复现失败**

Run: `cd apps/agent && python3 -m pytest -q`
Expected: `ModuleNotFoundError: No module named 'medtrust_agent'`(9 errors during collection)。

- [ ] **Step 2: 加 pytest 配置**(pyproject.toml 末尾)

```toml
[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 3: 重跑**

Run: `cd apps/agent && python3 -m pytest -q`
- 若通过 → 组5 L3(cox_km / psm_iptw / rws_causal)验证完成。
- **若报缺 `torch`/`lifelines`/`sklearn` 等** → 是**环境前提**(本机 `python3` 无这些依赖),非代码问题:**停下**,向用户报告需用装了 `apps/agent` 依赖的 Python(`pip install -e 'apps/agent[dev]'` 或指定其解释器),不要在此 `pip install torch`(过重)。

---

## Definition of Done

- [ ] `pnpm --filter @medtrust/connector test` 全绿(0 失败套件)。
- [ ] `pnpm --filter api test -- runtime/rws-orchestrator` 仍全绿(未回归)。
- [ ] agent:pytest 能解析 `medtrust_agent`;要么全绿,要么明确停在"缺运行依赖"的环境前提并上报。
- [ ] 三端状态如实汇报;提交与否交用户。
