/**
 * 本地/测试用 L1.5 装配（D10.4 的第二块）：把 `registerL15Operators` 接到本地节点执行面上。
 *
 * 与生产 `wiring/wire-l15.ts`（`L15OperatorWiring`）同源，但依赖本地替身：
 * 数据取本地库（`aggregateInternal` 回调内，行不外泄）、模块取复现构建清单（`local-module-client`）、
 * 降密用既有 `OutputGate`。
 */
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { AlgorithmSandboxExecutor } from '../domain/sandbox/algorithm-sandbox-executor';
import { projectDisproportionality } from '../domain/sandbox/disproportionality-sandbox';
import { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import type { MdopStageExecutor } from '../mdop/mdop-executor';
import { createLocalModuleClient } from './local-module-client';
import { registerL15Operators, type ProportionalityBucket } from '@medtrust/domain-med';

export function registerLocalL15(
  executor: MdopStageExecutor,
  options: { loadRows: () => Promise<readonly unknown[]>; moduleDir: string },
): void {
  const modules = createLocalModuleClient(options.moduleDir);
  const sandbox = new AlgorithmSandboxExecutor(modules, new WasmSandboxRunner());
  const gate = new OutputGate(new AuditService(), new Deidentifier());
  registerL15Operators(
    executor as never,
    {
      loadRows: options.loadRows,
      snapshotOf: () => null,
      runProportionality: async (
        rows: readonly unknown[],
        drug: string,
        opts: { stage: { jobId: string; stage: { op_digest?: string } } },
      ) => {
        const pinnedSm3 = String(opts.stage.stage.op_digest ?? '').replace(/^sm3:/, '');
        const projection = projectDisproportionality(rows as never, drug);
        const result = await sandbox.runProjection(projection, {
          pinnedModule: { analysisType: 'disproportionality', sm3: pinnedSm3 },
          taskId: opts.stage.jobId,
        });
        const buckets: ProportionalityBucket[] = result.buckets.map((b) => ({ key: b.key, count: b.count, rate: b.rate, b: b.b, c: b.c, d: b.d }));
        return { buckets, moduleSm3: result.moduleSm3 };
      },
      gate: (candidate: unknown, minCell: number, meta: { contractId?: string } | undefined) => gate.pass(candidate as never, minCell, meta as never) as unknown as Record<string, unknown>,
    } as never,
  );
}
