/**
 * MDOP 背板的 RWS 执行器 —— 旧接线下线的**接缝**（change `mdop-rws-ladder-migration` 4.3）。
 *
 * 与 `RwsExecutor` **同公开面**（`run` / `runWithExecution`），可直接替换在 `ConnectorTaskRunner` 的
 * executor 位上：**已迁到 MDOP 的分析类型走节点阶段链**，未迁移的类型**原样回落旧执行器**。
 *
 * 两种计划形态：
 *  - `projection`：投影型（本地行 → 投影 → 单算子 C2 → 降密 C3），用于分类计数类；
 *  - `stages`：显式阶段序列（source → 系统算子 → declassify），用于 L1.5 / 因果类等系统算子型。
 *
 * 基座中性：本文件不出现行业词 —— 计划（算子、阶段参数、投影种类与字段名、闭合分类键）由**行业包**
 * 产出，经 `MdopRwsPlanPort` 由组装根（`src/wiring/`）注入；本地行只在 `withRows` 回调作用域内可见。
 */
import { Logger } from '@nestjs/common';
import type { AggregateResult, RwsAnalysis } from '../domain/types';
import type { RwsRunOptions, RwsRunOutcome } from '../domain/rws-executor';
import type { MdopStageExecutor } from './mdop-executor';
import { NODE_DECLASSIFY_OP } from '../tee-node/declassify-op';

/** 阶段序列里的一段（系统算子型计划用；`kind` 决定清单形状）。 */
export interface MdopLocalStage {
  id: string;
  op: string;
  params: Record<string, unknown>;
  kind: 'wasm' | 'system';
  schema: string;
  /** wasm 阶段必给：模块摘要（裸 hex）。 */
  digest?: string;
  /** 输入取自哪个前序阶段的输出；缺省表示不需要输入（如 source 阶段）。 */
  from?: string;
}

/** 行业包给的一次**本地**执行计划。 */
export interface MdopLocalPlan {
  /** `projection` = 投影型；`stages` = 显式阶段序列。 */
  mode: 'projection' | 'stages';
  /** `stages` 模式：按序执行；`terminalId` 指定取哪个阶段的输出折算（缺省末段）。 */
  stages?: MdopLocalStage[];
  terminalId?: string;
  /** `projection` 模式：节点算子与阶段参数。 */
  op?: string;
  schema?: string;
  params?: Record<string, unknown>;
  moduleAnalysisType?: string;
  /** `projection` 模式：投影描述（种类 + 字段名；域词由包给）。 */
  projection?: {
    kind: 'scalar-category' | 'list-categories' | 'ae-signal';
    field: string;
    emptyPlaceholder?: string;
    filter?: { field?: string; value?: string };
  };
}

export interface MdopRwsPlanPort {
  planFor(analysis: RwsAnalysis, taskId: string): MdopLocalPlan | undefined;
  /** 按投影描述把本地行封成投影信封（实现里用本目录的投影函数）。 */
  project(plan: MdopLocalPlan, rows: readonly unknown[]): Record<string, unknown>;
  /**
   * 可选：**证据侧增强**（如逐变量缺失率审计与质量报告，L1.5-data-audit）。
   * 由组装根实现（要认识领域字段），本层只负责在返回前调用它。
   */
  enrich?(aggregate: AggregateResult, rows: readonly unknown[]): AggregateResult;
  /**
   * 可选：**分析侧准备**（协议队列收窄、缺失值处理）—— 必须在投影之前应用（与旧链同序）。
   * 由组装根实现（要认识领域字段与协议声明）；本层只按顺序调用。
   */
  prepareRows?(
    rows: readonly unknown[],
    analysis: RwsAnalysis,
  ): { rows: readonly unknown[]; missingnessLog?: unknown };
}

export interface MdopRwsExecutorDeps {
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
  holder: string;
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
    if (plan.mode === 'stages') return this.runStageSequence(plan, analysis, taskId);
    return this.deps.withRows((rows) => this.runProjectionPlan(plan, analysis, taskId, rows));
  }

  /** 投影型：本地行 → 投影 → 单算子（C2）→ 降密（C3）。 */
  private async runProjectionPlan(
    plan: MdopLocalPlan,
    analysis: RwsAnalysis,
    taskId: string,
    rows: readonly unknown[],
  ): Promise<RwsRunOutcome> {
    const moduleAnalysisType = plan.moduleAnalysisType ?? '';
    const sm3 = this.deps.moduleSm3(moduleAnalysisType);
    if (!sm3) throw new Error(`节点模块库缺模块：${moduleAnalysisType}`);
    const minCell = this.deps.minCell ?? 5;
    const schema = plan.schema ?? '';
    // 分析侧准备先于投影（旧链同序：取数 → 队列收窄 → 缺失值处理 → 投影 → 计数）。
    const prepared = this.deps.port.prepareRows
      ? this.deps.port.prepareRows(rows, analysis)
      : { rows };
    const envelope = this.deps.port.project(plan, prepared.rows);

    const c2 = await this.deps.executor.execute(
      {
        jobId: taskId,
        stage: {
          id: 'op',
          node: this.deps.holder,
          op: plan.op ?? '',
          op_digest: `sm3:${sm3}`,
          params: { dataset: { ref: 'rows' }, ...(plan.params ?? {}) },
          inputs: [{ from: 'rows' }],
          input_labels: ['C2'],
          output_label: 'C2',
          output_schema: schema,
        },
        inputs: new Map([['rows', envelope]]),
        attempt: 1,
      } as never,
      wasmManifest(plan.op ?? '', `sm3:${sm3}`, schema) as never,
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
          output_schema: schema,
        },
        inputs: new Map([['op', c2.payload as unknown]]),
        attempt: 1,
      } as never,
      systemManifest(schema) as never,
    );

    const adapted = adaptAggregate(analysis.type, c3.payload as Record<string, unknown>, envelope);
    const enriched = this.deps.port.enrich ? this.deps.port.enrich(adapted, prepared.rows) : adapted;
    const aggregate = prepared.missingnessLog
      ? ({ ...enriched, missingnessLog: prepared.missingnessLog } as AggregateResult)
      : enriched;
    this.logger.log(`MDOP 本地阶段链完成 type=${analysis.type} job=${taskId} n=${aggregate.cohortSize}`);
    return { aggregate, execution: { isolation: 'none' as const } };
  }

  /** 系统算子型：按序执行阶段序列，输入按 `from` 取自前序输出。 */
  private async runStageSequence(
    plan: MdopLocalPlan,
    analysis: RwsAnalysis,
    taskId: string,
  ): Promise<RwsRunOutcome> {
    const stages = plan.stages ?? [];
    if (!stages.length) throw new Error('阶段序列为空（计划构造失败）');
    return this.deps.withRows(async (rows) => {
      const outputs = new Map<string, unknown>();
      let terminal: unknown;
      const terminalId = plan.terminalId ?? stages[stages.length - 1].id;
      for (const st of stages) {
        const digest = st.digest ? `sm3:${st.digest}` : `component:${st.op.split('@')[0]}@1`;
        const manifest =
          st.kind === 'wasm'
            ? wasmManifest(st.op, digest, st.schema)
            : systemManifestFor(st.op, st.schema, digest);
        const inputs = new Map<string, unknown>();
        if (st.from) inputs.set(st.from, outputs.get(st.from));
        const out = await this.deps.executor.execute(
          {
            jobId: taskId,
            stage: {
              id: st.id,
              node: this.deps.holder,
              op: st.op,
              op_digest: digest,
              params: st.params,
              inputs: st.from ? [{ from: st.from }] : [],
              input_labels: st.from ? ['C2'] : [],
              output_label: 'C2',
              output_schema: st.schema,
            },
            inputs,
            attempt: 1,
          } as never,
          manifest as never,
        );
        outputs.set(st.id, out.payload);
        if (st.id === terminalId) terminal = out.payload;
      }
      void rows; // source 阶段自取行；本层不把行外送
      const aggregate = adaptAggregate(analysis.type, (terminal ?? {}) as Record<string, unknown>, {});
      this.logger.log(`MDOP 本地阶段序列完成 type=${analysis.type} job=${taskId} n=${aggregate.cohortSize}`);
      return { aggregate, execution: { isolation: 'none' as const } };
    });
  }
}

/** C3 载荷（{ buckets, rowCount, recordCount }）折算成任务层的聚合形状。 */
function adaptAggregate(
  analysisType: string,
  c3: Record<string, unknown>,
  envelope: Record<string, unknown>,
): AggregateResult {
  const raw = Array.isArray(c3.buckets) ? (c3.buckets as Array<Record<string, unknown>>) : [];
  const cohortSize = Number(
    c3.cohortSize ?? c3.recordCount ?? c3.rowCount ?? envelope.records ?? envelope.n ?? 0,
  );
  const buckets = raw.map((b) => {
    const count = Number(b.count ?? 0);
    return {
      key: String(b.key ?? ''),
      count,
      rate: cohortSize > 0 ? count / cohortSize : 0,
      suppressed: Boolean(b.suppressed),
      // L1.5 的 2×2 单元格随桶出域（下游合并算子要用），不得在折算处丢失。
      ...(b.b !== undefined ? { b: Number(b.b) } : {}),
      ...(b.c !== undefined ? { c: Number(b.c) } : {}),
      ...(b.d !== undefined ? { d: Number(b.d) } : {}),
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

/** 机制类系统算子的清单（source/seal/declassify/merge）—— 不许冒充分析算子。 */
function systemManifestFor(op: string, schema: string, digest: string) {
  const mechanism = op.split('@')[0].split('.')[0];
  // 只有降密算子把标签抬到 C3；其余机制算子的输出规则必须是 inherit（schema 强制）。
  const labelRule = mechanism === 'declassify' ? 'C3' : 'inherit';
  return {
    apiVersion: 'mdop/v1',
    kind: 'system',
    id: op.split('@')[0],
    version: '1.0.0',
    category: mechanism,
    digest,
    publisher: 'urn:tds:platform',
    inputs: [{ name: 'in', schema, accept_labels: ['C2'] }],
    outputs: [{ name: 'out', schema, label_rule: labelRule }],
    params: {},
    environments: ['tee'],
    security: { network: 'none' },
    component: `${mechanism}-operator@1.0.0`,
  };
}
