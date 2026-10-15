import { Injectable, Optional } from '@nestjs/common';
import { CausalExecutor } from './causal/causal-executor';
import { LocalStore } from './local-store';
import { Deidentifier } from './deidentifier';
import { SoftwareSealedCompute } from './tee';
import {
  RwsAnalysis,
  AggregateResult,
  ExecutionAnnotation,
  InternalRecord,
} from './types';
import { comparativeEffectEstimate } from './comparative-effect';
import { matchesMedication } from './clinical-matching';
import { applyMissingness, MissingnessDeclarationLike } from './missingness';
import { passesCohortDefinition } from './cohort-definition';
import { auditVariables, buildQualityReport } from './data-audit';
import { AlgorithmSandboxExecutor } from './sandbox/algorithm-sandbox-executor';
import { PinnedModuleRef } from './sandbox/module-client';
import { projectDisproportionality } from './sandbox/disproportionality-sandbox';

export interface RwsRunOptions {
  /**
   * algorithm-sandbox:数字合约为该分析类型固定的算法模块。存在时该分析必须走
   * Wasm 沙箱(失败即任务失败,不回退到内置实现)。
   */
  pinnedModule?: PinnedModuleRef;
}

export interface RwsRunOutcome {
  aggregate: AggregateResult;
  /**
   * 执行隔离标注。与 attestationLevel 正交;由任务层在**输出闸门之后、算哈希之前**
   * 写入聚合结果内部,从而受结果 SM3 保护(design D7)。
   */
  execution: ExecutionAnnotation;
}

// Runs an RWS analysis over the connector-local rows and returns ONLY an
// aggregate. The analysis runs INSIDE the TEE: the rows are sealed into the
// enclave and the compute happens over decrypted data in-enclave (5.2); the
// raw rows never leave it. The returned aggregate is still raw — the output
// gate (5.3/5.4) is applied downstream by the task runner.
@Injectable()
export class RwsExecutor {
  private readonly causal: CausalExecutor;

  constructor(
    private readonly store: LocalStore,
    private readonly deid: Deidentifier,
    // 默认 new SoftwareSealedCompute()：生产判据下构造即抛（D9/CTL-09），不可能静默生效。
    private readonly tee: SoftwareSealedCompute = new SoftwareSealedCompute(),
    @Optional() causalExecutor?: CausalExecutor,
    @Optional() private readonly sandbox?: AlgorithmSandboxExecutor,
  ) {
    this.causal = causalExecutor ?? new CausalExecutor(store, tee);
  }

  run(analysis: RwsAnalysis, taskId = 'local'): AggregateResult | Promise<AggregateResult> {
    const outcome = this.runWithExecution(analysis, taskId);
    return outcome instanceof Promise
      ? outcome.then((o) => o.aggregate)
      : outcome.aggregate;
  }

  /**
   * 与 run() 同路径,但额外返回执行隔离标注(algorithm-sandbox D7)。
   * 合约未固定模块时标注 isolation=none,行为与既有实现完全一致。
   */
  runWithExecution(
    analysis: RwsAnalysis,
    taskId = 'local',
    opts?: RwsRunOptions,
  ): RwsRunOutcome | Promise<RwsRunOutcome> {
    if (analysis.type === 'causal-psm' || analysis.type === 'causal-survival') {
      return this.runCausal(analysis, taskId).then((aggregate) => ({
        aggregate,
        execution: { isolation: 'none' as const },
      }));
    }

    // algorithm-sandbox:合约固定了模块 → 必须走沙箱(不回退)。
    if (opts?.pinnedModule && analysis.type === 'disproportionality') {
      return this.runDisproportionalitySandbox(
        analysis,
        taskId,
        opts.pinnedModule,
      );
    }

    const result = this.store.aggregateInternal({ origin: 'internal', actor: 'rws-executor' }, (rows) => {
      // seal the local rows into the enclave; compute runs in-enclave
      const sealed = this.tee.seal(rows);
      return this.tee.run(sealed, (enclaveRows: InternalRecord[]) => {
        // L2-missing-data (rws-study-protocol-spec §3.4): apply the SAP-declared
        // missingness strategy BEFORE computing the aggregate, and record a log
        // that reconciles to the declaration (no silent 多重插补/完全病例 混用).
        const missingness = (analysis as { missingness?: MissingnessDeclarationLike }).missingness;
        const stratifyBy = analysis.stratifyBy ?? ['ageBand'];
        const { rows: analysisRows, log } = missingness
          ? applyMissingness(enclaveRows, missingness, stratifyBy)
          : { rows: enclaveRows, log: undefined };

        let aggregate: AggregateResult;
        let auditedRows: readonly InternalRecord[] = analysisRows;
        // L1.5 失衡需全人群(算非暴露组 c/d),不能用按 drug 过滤后的队列;但若协议声明了
        // tte 队列 (L1.5-cohort-def), 必须先应用纳入/排除再算 2×2, 使 L1.5 与下游层级
        // 复现同一队列。
        if (analysis.type === 'disproportionality') {
          const tte = analysis.tte;
          const cohortRows = tte
            ? analysisRows.filter((r) =>
                passesCohortDefinition(r, { inclusion: tte.inclusion, exclusion: tte.exclusion }),
              )
            : analysisRows;
          aggregate = disproportionalityTables(cohortRows, analysis.drug);
          auditedRows = cohortRows;
        } else if (analysis.type === 'comparative-effect') {
          aggregate = comparativeEffectEstimate(
            analysisRows,
            analysis.drug ?? '',
            analysis.outcome ?? '',
            analysis.outcomeKind ?? 'adverse_event',
            stratifyBy,
          );
          auditedRows = analysisRows;
        } else {
          const cohort = analysis.drug
            ? analysisRows.filter((r) => matchesMedication(r.medications, analysis.drug!))
            : analysisRows;
          // 4.3：已迁 MDOP 的类型不再有旧链实现（改走 `mdop/mdop-rws-executor.ts` 适配器）。
          // 这里显式失配，避免「历史载荷经旧链执行」的兜底口径悄悄回到代码里（D8）。
          aggregate =
            analysis.type === 'cohort-count'
              ? this.cohortCount(cohort)
              : analysis.type === 'condition-prevalence'
                ? this.conditionPrevalence(cohort)
                : legacyRefuses(analysis.type);
          auditedRows = cohort;
        }

        // L1.5-data-audit: 聚合结果必须携带逐变量缺失率/分布审计与质量报告,
        // 任一变量缺失率>30% 时显式告警 (high_missing_rate)。审计是聚合语义,
        // 只含计数/比率/分布摘要,不携带行级或可识别数据 (INV-GATE-01)。
        const audit = auditVariables(auditedRows);
        const qualityReport = buildQualityReport(audit);
        const highMissingWarnings = audit.highMissingVariables.map((variable) => ({
          code: 'high_missing_rate' as const,
          detail: `${variable} 缺失率>30%，已列入高缺失变量清单`,
        }));
        const withAudit: AggregateResult = {
          ...aggregate,
          dataAudit: audit,
          qualityReport,
          warnings: highMissingWarnings.length
            ? [...(aggregate.warnings ?? []), ...highMissingWarnings]
            : aggregate.warnings,
        };
        return log
          ? ({ ...withAudit, missingnessLog: log } as AggregateResult)
          : withAudit;
      }).output;
    });

    // Defensive: the aggregate that is about to leave must carry no identifiers.
    if (this.deid.containsDirectIdentifier(result)) {
      throw new Error('aggregate unexpectedly contains a direct identifier — refusing to emit');
    }
    return { aggregate: result, execution: { isolation: 'none' } };
  }

  /**
   * algorithm-sandbox 执行路径(design D3/D9)。
   *
   * 最小列投影在本地库守卫(aggregateInternal)内、SoftwareSealedCompute 内完成;词条文本
   * 始终留在宿主一侧,沙箱只回 2×2 计数。模块校验/执行/不变量校验任一失败即抛错。
   */
  private async runDisproportionalitySandbox(
    analysis: RwsAnalysis,
    taskId: string,
    pinnedModule: PinnedModuleRef,
  ): Promise<RwsRunOutcome> {
    if (!this.sandbox) {
      throw new Error(
        '合约固定了算法模块,但沙箱执行器未装配 —— 拒绝执行(fail-closed,不回退到内置实现)',
      );
    }

    const prepared = this.store.aggregateInternal(
      { origin: 'internal', actor: 'rws-executor' },
      (rows) => {
        const sealed = this.tee.seal(rows);
        return this.tee.run(sealed, (enclaveRows: InternalRecord[]) => {
          const missingness = (analysis as { missingness?: MissingnessDeclarationLike }).missingness;
          const stratifyBy = analysis.stratifyBy ?? ['ageBand'];
          const { rows: analysisRows, log } = missingness
            ? applyMissingness(enclaveRows, missingness, stratifyBy)
            : { rows: enclaveRows, log: undefined };

          const tte = analysis.tte;
          const isIncluded = tte
            ? (r: InternalRecord) =>
                passesCohortDefinition(r, { inclusion: tte.inclusion, exclusion: tte.exclusion })
            : undefined;
          const cohortRows = isIncluded ? analysisRows.filter(isIncluded) : analysisRows;

          // 只在宿主一侧:行 → 0/1 标记列。词条文本不进沙箱内存。
          const projection = projectDisproportionality(
            analysisRows,
            analysis.drug,
            isIncluded,
          );

          const audit = auditVariables(cohortRows);
          const qualityReport = buildQualityReport(audit);
          const highMissingWarnings = audit.highMissingVariables.map((variable) => ({
            code: 'high_missing_rate' as const,
            detail: `${variable} 缺失率>30%，已列入高缺失变量清单`,
          }));
          const base: AggregateResult = {
            analysisType: 'disproportionality',
            cohortSize: projection.cohortSize,
            buckets: [],
            dataAudit: audit,
            qualityReport,
            warnings: highMissingWarnings.length ? highMissingWarnings : undefined,
          };
          return {
            projection,
            base: log
              ? ({ ...base, missingnessLog: log } as AggregateResult)
              : base,
          };
        }).output;
      },
    );

    const sandboxed = await this.sandbox.runProjection(prepared.projection, {
      pinnedModule,
      taskId,
    });
    const result: AggregateResult = { ...prepared.base, buckets: sandboxed.buckets };

    if (this.deid.containsDirectIdentifier(result)) {
      throw new Error('aggregate unexpectedly contains a direct identifier — refusing to emit');
    }
    return {
      aggregate: result,
      execution: {
        isolation: 'wasm-sandbox',
        moduleSm3: sandboxed.moduleSm3,
        abiVersion: sandboxed.abiVersion,
      },
    };
  }

  private async runCausal(
    analysis: RwsAnalysis,
    taskId: string,
  ): Promise<AggregateResult> {
    const result = await this.causal.run(analysis, taskId);
    if (this.deid.containsDirectIdentifier(result)) {
      throw new Error('aggregate unexpectedly contains a direct identifier — refusing to emit');
    }
    return result;
  }

  private cohortCount(cohort: readonly InternalRecord[]): AggregateResult {
    const counts = new Map<string, number>();
    for (const r of cohort) counts.set(r.ageBand, (counts.get(r.ageBand) ?? 0) + 1);
    const n = cohort.length || 1;
    return {
      analysisType: 'cohort-count',
      cohortSize: cohort.length,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  /** Top chronic-condition labels across the local cohort (metadata only leaves the connector). */
  private conditionPrevalence(cohort: readonly InternalRecord[]): AggregateResult {
    const counts = new Map<string, number>();
    for (const r of cohort) {
      const labels = r.conditions.length ? r.conditions : ['无明确慢病标签'];
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    const n = cohort.length || 1;
    return {
      analysisType: 'condition-prevalence',
      cohortSize: cohort.length,
      buckets: [...counts.entries()]
        .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

// L1.5 失衡信号: 对目标药 drug,在全人群上按每个不良事件 term 构建 2×2
// (a=drug∩event, b=drug∩非event, c=非drug∩event, d=非drug∩非event). 仅聚合计数,无个体行.
export function disproportionalityTables(
  cohort: readonly InternalRecord[],
  drug: string | undefined,
): AggregateResult {
  if (!drug) {
    throw new Error('disproportionality 需指定 drug of interest');
  }
  const onDrug = (r: InternalRecord) => matchesMedication(r.medications, drug);
  const nDrug = cohort.filter(onDrug).length;
  const nNoDrug = cohort.length - nDrug;
  const events = new Set<string>();
  for (const r of cohort) for (const e of r.adverseEvents) events.add(e.term);
  const n = cohort.length || 1;
  const buckets = [...events]
    .map((event) => {
      let a = 0;
      let c = 0;
      for (const r of cohort) {
        if (!r.adverseEvents.some((e) => e.term === event)) continue;
        if (onDrug(r)) a++;
        else c++;
      }
      return { key: event, count: a, rate: +(a / n).toFixed(4), b: nDrug - a, c, d: nNoDrug - c };
    })
    .sort((x, y) => y.count - x.count);
  return { analysisType: 'disproportionality', cohortSize: cohort.length, buckets };
}

/**
 * 对拍参照（台账 `retained: test-reference`）：AE 的**旧链计数口径**，仅供等价性测试比对。
 * 分发路径（`runWithExecution`）已不再走它 —— 迁到 MDOP 的类型在那里显式失配。
 */
export function adverseEventSignalTables(
  cohort: readonly InternalRecord[],
  drug?: string,
): AggregateResult {
  const filtered = drug
    ? cohort.filter((r) => matchesMedication(r.medications, drug))
    : cohort;
  const counts = new Map<string, number>();
  for (const r of filtered) {
    for (const e of r.adverseEvents) {
      counts.set(e.organSystem, (counts.get(e.organSystem) ?? 0) + 1);
    }
  }
  const n = filtered.length || 1;
  return {
    analysisType: 'adverse-event-signal',
    cohortSize: filtered.length,
    buckets: [...counts.entries()]
      .map(([key, count]) => ({ key, count, rate: +(count / n).toFixed(4) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** 旧链对已迁类型的统一失配（不静默、不兜底）。 */
function legacyRefuses(analysisType: string): never {
  throw new Error(
    `旧通道不再实现该分析类型：${analysisType}（已迁 MDOP，见 mdop/mdop-rws-executor.ts）`,
  );
}
