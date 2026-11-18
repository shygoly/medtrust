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
import {
  prepareDisproportionalityRows,
  projectDisproportionality,
  type TemporalWindowOptions,
} from '../domain/sandbox/disproportionality-sandbox';
import type { InternalRecord } from '../domain/types';
import { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import type { MdopStageExecutor } from '../mdop/mdop-executor';
import { createLocalModuleClient } from './local-module-client';
import { registerL15Operators, type ProportionalityBucket } from '@medtrust/domain-med';

export function registerLocalL15(
  executor: MdopStageExecutor,
  options: {
    loadRows: () => Promise<readonly unknown[]>;
    moduleDir: string;
    /** 节点侧准备完成后的证据回传（队列规模与缺失值日志）。 */
    onPrepared?: (jobId: string, evidence: { cohortSize: number; missingnessLog?: unknown }) => void;
  },
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
        opts: {
          stage: {
            jobId: string;
            stage: { op_digest?: string; params: Record<string, unknown> };
          };
        },
      ) => {
        const pinnedSm3 = String(opts.stage.stage.op_digest ?? '').replace(/^sm3:/, '');
        // 分析侧准备（与生产 wire-l15 同函数）：计划阶段参数携带声明；缺声明时一字不变。
        const params = opts.stage.stage.params ?? {};
        const prepared = prepareDisproportionalityRows(
          rows as readonly InternalRecord[],
          params,
        );
        options.onPrepared?.(opts.stage.jobId, {
          cohortSize: prepared.rows.length,
          ...(prepared.missingnessLog ? { missingnessLog: prepared.missingnessLog } : {}),
        });
        const temporalWindow = params.temporalWindow as TemporalWindowOptions | undefined;
        const projection = projectDisproportionality(
          prepared.rows,
          drug,
          undefined,
          temporalWindow,
        );
        const result = await sandbox.runProjection(projection, {
          pinnedModule: { analysisType: 'disproportionality', sm3: pinnedSm3 },
          taskId: opts.stage.jobId,
        });
        const buckets: ProportionalityBucket[] = result.buckets.map((b) => ({ key: b.key, count: b.count, rate: b.rate, b: b.b, c: b.c, d: b.d }));
        return {
          buckets,
          moduleSm3: result.moduleSm3,
          cohortSize: projection.cohortSize,
          ...(projection.temporalMode ? { temporalMode: projection.temporalMode } : {}),
        };
      },
      gate: (candidate: unknown, minCell: number, meta: { contractId?: string } | undefined) => gate.pass(candidate as never, minCell, meta as never) as unknown as Record<string, unknown>,
    } as never,
  );
}
