/**
 * MDOP 背板的 RWS 执行器 —— 旧接线下线的**接缝**（change `mdop-rws-ladder-migration` 4.3 前置）。
 *
 * 与 `RwsExecutor` **同公开面**（`run` / `runWithExecution`），可直接替换在 `ConnectorTaskRunner` 的
 * executor 位上：**已迁到 MDOP 的分析类型走节点阶段链**（投影 → 节点内算子 → 降密/发布审查），未迁移的
 * 类型**原样回落旧执行器**（该兜底随逐型删除自动收缩到零）。
 *
 * 基座中性（KERNEL/PACK 判据）：本文件**不出现任何行业词** —— 计划（算子、阶段参数、投影种类与字段名、
 * 闭合分类键）由**行业包**产出，经 `MdopRwsPlanPort` 由组装根（`src/wiring/`）注入。本地行只在
 * `withRows` 的**回调作用域**内可见（`LocalStore.aggregateInternal` 纪律：行不出回调）。
 */
import { Logger } from '@nestjs/common';
import type { AggregateResult, RwsAnalysis } from '../domain/types';
import type { RwsRunOptions, RwsRunOutcome } from '../domain/rws-executor';
import type { MdopStageExecutor } from './mdop-executor';
import { NODE_DECLASSIFY_OP } from '../tee-node/declassify-op';

/** 行业包给的一次**本地**执行计划（已收敛到单持有方的一段）。 */
export interface MdopLocalPlan {
  op: string;
  schema: string;
  params: Record<string, unknown>;
  moduleAnalysisType: string;
  projection: {
    kind: 'scalar-category' | 'list-categories' | 'ae-signal';
    field: string;
    emptyPlaceholder?: string;
    filter?: { field?: string; value?: string };
  };
}

/** 组装根实现的领域侧端口：本文件只认这个接口，不认识任何具体分析类型。 */
export interface MdopRwsPlanPort {
  planFor(analysis: RwsAnalysis, taskId: string): MdopLocalPlan | undefined;
  project(plan: MdopLocalPlan, rows: readonly unknown[]): Record<string, unknown>;
}

export interface MdopRwsExecutorDeps {
  /** 未迁移类型的回落目标（旧执行器；同公开面）。 */
  legacy: {
    runWithExecution(analysis: RwsAnalysis, taskId?: string, opts?: RwsRunOptions): unknown;
    run(analysis: RwsAnalysis, taskId?: string): AggregateResult | Promise<AggregateResult>;
  };
  port: MdopRwsPlanPort;
  /** `createNodeExecutor(...)` 装配出的节点执行面（wasm + 降密算子都已接）。 */
  executor: MdopStageExecutor;
  /** 模块库：按清单 `analysisType` 取 SM3（取不到即拒，不回退）。 */
  moduleSm3(moduleAnalysisType: string): string | undefined;
  /** 在本地行的回调作用域内执行（行不外泄）。 */
  withRows<T>(fn: (rows: readonly unknown[]) => T): T;
  /** 本持有方 URN（阶段的 `node`）。 */
  holder: string;
  /** 降密阈值（缺省 5；真实部署由合约条款决定）。 */
  minCell?: number;
}

export class MdopRwsExecutor {
  private readonly logger = new Logger(MdopRwsExecutor.name);

  constructor(private readonly deps: MdopRwsExecutorDeps) {}

  run(analysis: RwsAnalysis, taskId = 'local'): AggregateResult | Promise<AggregateResult> {
    const outcome = this.runWithExecution(analysis, taskId);
    return outcome instanceof Promise ? outcome.then((o) => o.aggregate) : outcome.aggregate;
  }

  runWithExecution(
    analysis: RwsAnalysis,
    taskId = 'local',
    opts?: RwsRunOptions,
  ): RwsRunOutcome | Promise<RwsRunOutcome> {
    const plan = this.deps.port.planFor(analysis, taskId);
    if (!plan) {
      return this.deps.legacy.runWithExecution(analysis, taskId, opts) as RwsRunOutcome | Promise<RwsRunOutcome>;
    }
    return this.deps.withRows((rows) => this.runStages(plan, analysis, taskId, rows));
  }

  /** 本地单持有方跑一段 MDOP 阶段链：投影 → 节点内算子（C2）→ 降密（C3）。 */
  private async runStages(
    plan: MdopLocalPlan,
    analysis: RwsAnalysis,
    taskId: string,
    rows: readonly unknown[],
  ): Promise<RwsRunOutcome> {
    const sm3 = this.deps.moduleSm3(plan.moduleAnalysisType);
    if (!sm3) throw new Error(`节点模块库缺模块：${plan.moduleAnalysisType}`);
    const minCell = this.deps.minCell ?? 5;
    const envelope = this.deps.port.project(plan, rows);

    const c2 = await this.deps.executor.execute(
      {
        jobId: taskId,
        stage: {
          id: 'op',
          node: this.deps.holder,
          op: plan.op,
          op_digest: `sm3:${sm3}`,
          params: { dataset: { ref: 'rows' }, ...plan.params },
          inputs: [{ from: 'rows' }],
          input_labels: ['C2'],
          output_label: 'C2',
          output_schema: plan.schema,
        },
        inputs: new Map([['rows', envelope]]),
        attempt: 1,
      } as never,
      wasmManifest(plan.op, `sm3:${sm3}`, plan.schema) as never,
    );

    const c3 = await this.deps.executor.execute(
      {
        jobId: taskId,
        stage: {
          id: 'dec',
          node: this.deps.holder,
          op: NODE_DECLASSIFY_OP,
          op_digest: 'component:node-publication-review@1',
          params: { contractId: taskId, minCell },
          inputs: [{ from: 'op' }],
          input_labels: ['C2'],
          output_label: 'C3',
          output_schema: plan.schema,
        },
        inputs: new Map([['op', c2.payload as unknown]]),
        attempt: 1,
      } as never,
      systemManifest(plan.schema) as never,
    );

    const aggregate = adaptAggregate(analysis.type, c3.payload as Record<string, unknown>, envelope);
    this.logger.log(`MDOP 本地阶段链完成 type=${analysis.type} job=${taskId} n=${aggregate.cohortSize}`);
    return { aggregate, execution: { isolation: 'none' as const } };
  }
}

/** C3 载荷（{ buckets, rowCount, recordCount }）折算成任务层的聚合形状。 */
function adaptAggregate(
  analysisType: string,
  c3: Record<string, unknown>,
  envelope: Record<string, unknown>,
): AggregateResult {
  const raw = Array.isArray(c3.buckets) ? (c3.buckets as Array<Record<string, unknown>>) : [];
  const cohortSize = Number(c3.recordCount ?? envelope.records ?? envelope.n ?? 0);
  const buckets = raw.map((b) => {
    const count = Number(b.count ?? 0);
    return {
      key: String(b.key ?? ''),
      count,
      rate: cohortSize > 0 ? count / cohortSize : 0,
      suppressed: Boolean(b.suppressed),
    };
  });
  return { analysisType, cohortSize, buckets };
}

function wasmManifest(op: string, digest: string, schema: string) {
  return {
    apiVersion: 'mdop/v1',
    kind: 'wasm',
    id: op.split('@')[0],
    version: '1.0.0',
    category: 'local',
    digest,
    publisher: 'urn:tds:sh-med:operator-registry',
    inputs: [{ name: 'rows', schema: 'mdop.projection/1.0', accept_labels: ['C2'] }],
    outputs: [{ name: 'counts', schema, label_rule: 'inherit' }],
    params: {},
    environments: ['tee'],
    security: { network: 'none' },
    build: { source_digest: `sm3:${'a'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
  };
}

function systemManifest(schema: string) {
  return {
    apiVersion: 'mdop/v1',
    kind: 'system',
    id: 'declassify.small_cell',
    version: '1.0.0',
    category: 'declassify',
    digest: 'component:node-publication-review@1',
    publisher: 'urn:tds:platform',
    inputs: [{ name: 'in', schema, accept_labels: ['C2'] }],
    outputs: [{ name: 'out', schema, label_rule: 'C3' }],
    params: {},
    environments: ['tee'],
    security: { network: 'none' },
    component: 'node-publication-review@1.0.0',
  };
}
