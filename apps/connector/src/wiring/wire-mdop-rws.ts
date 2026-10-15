/**
 * 组装关注点（Nest provider/工厂）：把**行业包**的计划模板与投影接到中性适配器
 * `mdop/mdop-rws-executor.ts` 上。
 *
 * 为什么住 `src/wiring/`：内核目录（`src/mdop/`）MUST NOT 认识具体分析类型（change `kernel-stage-contract` /
 * 纯度棘轮）；「哪个类型用哪个模板、投影描述对应哪个投影函数」属**组装根知识**，只能住这里。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import type { AggregateResult, RwsAnalysis } from '../domain/types';
import { auditVariables, buildQualityReport } from '../domain/data-audit';
import { applyMissingness, type MissingnessDeclarationLike } from '../domain/missingness';
import { passesCohortDefinition } from '../domain/cohort-definition';
import type { InternalRecord, TteSpec } from '../domain/types';
import { createNodeExecutor } from '../tee-node/executor';
import { NodePublicationReview } from '../mdop/node/publication-review';
import {
  MdopRwsExecutor,
  type MdopLocalPlan,
  type MdopRwsPlanPort,
} from '../mdop/mdop-rws-executor';
import {
  aeSignalProjection,
  listCategoriesProjection,
  scalarCategoryProjection,
} from '../mdop/operators/seal';
import { registerMedTemplates } from '@medtrust/domain-med';
import { registerLocalL15 } from './local-l15-wiring';
import type { PlanTemplate, TemplateRegistry } from '@medtrust/space-kernel-spi';

/** 已迁到 MDOP 的分析类型  计划模板 id（未列入者回落旧执行器）。 */
const TEMPLATE_ID_BY_TYPE: Readonly<Record<string, string>> = {
  'adverse-event-signal': 'rws.adverse-event-signal',
  'cohort-count': 'rws.cohort-count',
  'condition-prevalence': 'rws.condition-prevalence',
  disproportionality: 'rws.l15.disproportionality',
};

/** L1.5 模板 id（阶段序列型）。 */
const L15_TEMPLATE_ID = 'rws.l15.disproportionality';

/** 本地单持有方执行所需的计划草案入参（申请方/合约等由调用方给，缺省给本地占位）。 */
export interface MdopLocalRunContext {
  spaceId: string;
  /** 本持有方参与方 id（计划里 `holders[].participantId`）。 */
  participantId: string;
  /** 本地数据产品 id（本地跑只作标识，不解析远端）。 */
  dataProductId: string;
  /** 本地合约副本 id。 */
  contractId: string;
  purpose?: string;
  drug?: string;
  /** 申请方声明的闭合分类键（缺省用包默认词典；与本持有方标签集不一致时必须显式给）。 */
  categoryKeys?: string[];
  /** 申请方声明的分层键值（`<年龄段>|<性别>` 形态；与本持有方分层口径一致）。 */
  strataKeys?: string[];
  minCell?: number;
}

/** 极小实现：包只依赖 `TemplateRegistry` 接口，基座侧的注册面在此落地。 */
export function createLocalTemplateRegistry(): TemplateRegistry {
  const byId = new Map<string, PlanTemplate>();
  return {
    register: (t) => void byId.set(t.id, t),
    resolve: (id) => byId.get(id),
  };
}

export class MedMdopRwsPlanPort implements MdopRwsPlanPort {
  private readonly registry: TemplateRegistry = createLocalTemplateRegistry();

  constructor(
    private readonly context: MdopLocalRunContext,
    private readonly moduleSm3: (analysisType: string) => string | undefined = () => undefined,
  ) {
    registerMedTemplates(this.registry);
  }

  planFor(analysis: RwsAnalysis, _taskId: string): MdopLocalPlan | undefined {
    const templateId = TEMPLATE_ID_BY_TYPE[analysis.type];
    if (!templateId) return undefined; // 未迁移：交给调用方回落旧执行器
    const template = this.registry.resolve(templateId);
    if (!template) return undefined;
    const ctx = this.context;
    const isStratified = templateId === TEMPLATE_ID_BY_TYPE['cohort-count'];
    const draft = template.build(
      {
        purpose: ctx.purpose ?? '本地执行',
        applicant: { org: ctx.participantId, project: 'local' },
        contracts: [ctx.contractId],
        ...(templateId === L15_TEMPLATE_ID
          ? { hospitals: [{ participantId: ctx.participantId, dataProductId: ctx.dataProductId }] }
          : { holders: [{ participantId: ctx.participantId, dataProductId: ctx.dataProductId }] }),
        ...(analysis.drug ?? ctx.drug ? { drug: analysis.drug ?? ctx.drug } : {}),
        // 分类键只给**按分类计数**的模板；队列规模型用分层键（给错了会被节点按闭合语法拒）。
        ...(ctx.categoryKeys?.length && !isStratified ? { categoryKeys: ctx.categoryKeys } : {}),
        ...(ctx.minCell !== undefined ? { minCell: ctx.minCell } : {}),
        notBefore: new Date(0).toISOString(),
        notAfter: new Date(Date.now() + 86_400_000).toISOString(),
        ...(isStratified && ctx.strataKeys?.length ? { strataKeys: [...ctx.strataKeys] } : {}),
      },
      { spaceId: ctx.spaceId },
    ) as {
      stages: Array<{ id: string; op: string; params: Record<string, unknown> }>;
    };
    if (templateId === L15_TEMPLATE_ID) {
      // L1.5：系统算子型阶段序列（source -> rws.disproportionality -> declassify）
      const suffix = ctx.participantId.replace(/[^A-Za-z0-9]/g, '');
      const byId = (id: string) => draft.stages.find((s) => s.id === id);
      const src = byId(`src_${suffix}`);
      const op = byId(`l15_${suffix}`);
      const dec = byId(`dec_${suffix}`);
      if (!src || !op || !dec) return undefined;
      const moduleType = String(op.op).replace(/^rws/, '').replace(/^\./, '').split('@')[0];
      const sm3 = this.moduleSm3(moduleType);
      if (!sm3) return undefined; // 本节点没有该模块：回落旧执行器（fail-closed 由上游兜）
      return {
        mode: 'stages',
        terminalId: String(dec.id),
        stages: [
          { id: String(src.id), op: String(src.op), params: src.params, kind: 'system', schema: 'mdop.dataset/1.0' },
          {
            id: String(op.id),
            op: String(op.op),
            // 声明经**计划阶段参数**到达节点（本变更 D1）：队列定义与缺失值声明随计划走，
            // 节点在投影之前应用（见 local-l15-wiring 的 runProportionality）。
            params: {
              ...op.params,
              ...(analysis.tte
                ? {
                    cohortDefinition: {
                      inclusion: (analysis.tte as { inclusion?: string[] }).inclusion ?? [],
                      exclusion: (analysis.tte as { exclusion?: string[] }).exclusion ?? [],
                    },
                  }
                : {}),
              ...((analysis as { missingness?: unknown }).missingness
                ? { missingnessDeclaration: (analysis as { missingness?: unknown }).missingness }
                : {}),
            },
            kind: 'wasm',
            digest: sm3,
            schema: 'rws.disproportionality/1.0',
            from: String(src.id),
          },
          { id: String(dec.id), op: String(dec.op), params: dec.params, kind: 'system', schema: 'rws.disproportionality/1.0', from: String(op.id) },
        ],
      };
    }
    const seal = draft.stages.find((s) => typeof s.params?.projection === 'string');
    const count = draft.stages.find((s) => s.op.startsWith('rws.') && s.params?.categoryKeys !== undefined);
    const dec = draft.stages.find((s) => s.params?.minCell !== undefined || s.op.startsWith('declassify.'));
    if (!seal || !count) return undefined;

    const projection = seal.params.projection as string;
    const filter =
      seal.params.filterField && seal.params.filterValue
        ? { field: String(seal.params.filterField), value: String(seal.params.filterValue) }
        : undefined;
    const kind =
      projection === 'ae-signal'
        ? ('ae-signal' as const)
        : projection === 'scalar-category'
          ? ('scalar-category' as const)
          : projection === 'list-categories'
            ? ('list-categories' as const)
            : undefined;
    if (!kind) return undefined;
    const field = String(
      kind === 'ae-signal'
        ? seal.params.eventField
        : kind === 'scalar-category'
          ? seal.params.categoryField
          : seal.params.listField,
    );
    if (!field) return undefined;

    return {
      mode: 'projection',
      op: String(count.op),
      schema: `${String(count.op).split('@')[0]}/1.0`,
      params: { categoryKeys: count.params.categoryKeys },
      moduleAnalysisType: String(count.op).replace(/^rws\./, '').split('@')[0],
      projection: {
        kind,
        field,
        ...(seal.params.emptyPlaceholder !== undefined
          ? { emptyPlaceholder: String(seal.params.emptyPlaceholder) }
          : {}),
        ...(filter ? { filter } : {}),
      },
    };
  }

  /** 取回节点侧准备的证据（取走即删，避免长期驻留）。 */
  evidenceFor(taskId: string): { cohortSize?: number; missingnessLog?: unknown } | undefined {
    const evidence = preparedByJob.get(taskId);
    if (evidence) preparedByJob.delete(taskId);
    return evidence;
  }

  /**
   * 分析侧准备（与旧链同序，先于投影）：
   *  ① 协议队列收窄（`analysis.tte` 的纳入/排除）；② 缺失值处理（`analysis.missingness`）并返回日志。
   * 声明取自任务的分析（本地/演示路径）；生产路径由平台把同一声明编译进计划的阶段参数。
   */
  prepareRows(
    rows: readonly unknown[],
    analysis: RwsAnalysis,
  ): { rows: readonly unknown[]; missingnessLog?: unknown } {
    let current = rows as readonly InternalRecord[];
    const tte = (analysis as { tte?: TteSpec }).tte;
    if (tte) {
      current = current.filter((r) =>
        passesCohortDefinition(r, { inclusion: tte.inclusion, exclusion: tte.exclusion }),
      );
    }
    const missingness = (analysis as { missingness?: MissingnessDeclarationLike }).missingness;
    if (!missingness) return { rows: current };
    const applied = applyMissingness(current, missingness, analysis.stratifyBy ?? ['ageBand']);
    return { rows: applied.rows, missingnessLog: applied.log };
  }

  /** 证据侧增强：逐变量缺失率/分布审计 + 质量报告 + 高缺失告警（旧链同款，L1.5-data-audit）。 */
  enrich(aggregate: AggregateResult, rows: readonly unknown[]): AggregateResult {
    const audit = auditVariables(rows as never);
    const qualityReport = buildQualityReport(audit);
    const warnings = audit.highMissingVariables.map((variable) => ({
      code: 'high_missing_rate' as const,
      detail: `${variable} 缺失率>30%，已列入高缺失变量清单`,
    }));
    return {
      ...aggregate,
      dataAudit: audit,
      qualityReport,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  project(plan: MdopLocalPlan, rows: readonly unknown[]): Record<string, unknown> {
    const projection = plan.projection;
    if (!projection) throw new Error('投影型计划缺投影描述');
    // 本地存储的行用 `subjectKey`，MDOP 投影面用 `linkKey` —— 这一层名差属组装根知识，
    // 在此补齐（两边的其余字段同名直通）。
    const upstream = {
      rows: rows.map((r) => {
        const row = r as Record<string, unknown>;
        return typeof row.linkKey === 'string' ? row : { ...row, linkKey: row.subjectKey };
      }),
    };
    const { kind, field, emptyPlaceholder, filter } = projection;
    if (kind === 'ae-signal') return aeSignalProjection(upstream, field, filter);
    if (kind === 'scalar-category') return scalarCategoryProjection(upstream, field, filter);
    return listCategoriesProjection(upstream, field, emptyPlaceholder ?? '', filter);
  }
}

/** 组装一个本地（单进程）MDOP RWS 执行器：节点执行面 + 计划端口 + 旧执行器兜底。 */
/** 节点侧准备证据（按任务暂存，取走即删）。 */
const preparedByJob = new Map<string, { cohortSize?: number; missingnessLog?: unknown }>();

export function createMdopRwsExecutor(options: {
  legacy: ConstructorParameters<typeof MdopRwsExecutor>[0]['legacy'];
  context: MdopLocalRunContext;
  moduleDir: string;
  withRows<T>(fn: (rows: readonly unknown[]) => T): T;
  holder: string;
  /** 是否注册本地 L1.5 系统算子（缺省 false）。 */
  localL15?: boolean;
}): MdopRwsExecutor {
  const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));

  // 模块 SM3 一律来自**复现构建清单**（与节点模块库同源），不硬编码。
  const manifest = JSON.parse(
    fs.readFileSync(path.join(options.moduleDir, 'manifest.json'), 'utf8'),
  ) as { modules: Array<{ analysisType: string; sm3: string; file: string }> };
  const sm3For = (analysisType: string): string | undefined =>
    manifest.modules.find((m) => m.analysisType === analysisType)?.sm3;
  // 本地跑：模块字节按**复现构建清单**解析（清单给 file/sm3），不要求摘要命名文件。
  const moduleBytes = (digest: string): Uint8Array | undefined => {
    const bare = String(digest).replace(/^sm3:/, '');
    const entry = manifest.modules.find((m) => m.sm3 === bare);
    return entry ? fs.readFileSync(path.join(options.moduleDir, entry.file)) : undefined;
  };
  const { executor } = createNodeExecutor({
    review,
    moduleBytes,
  });
  // 本地 L1.5 装配（D10.4）：系统算子要注册在节点执行面上才会被分派。
  // **默认不注册**（否则会改变只跑投影型类型的既有调用方的行为）；需要 L1.5/系统算子型的调用方显式打开。
  if (options.localL15) {
    registerLocalL15(executor, {
      loadRows: async () => options.withRows((rows) => [...rows]),
      moduleDir: options.moduleDir,
      onPrepared: (jobId, evidence) => preparedByJob.set(jobId, evidence),
    });
  }
  const port = new MedMdopRwsPlanPort(options.context, sm3For);
  return new MdopRwsExecutor({
    legacy: options.legacy,
    port,
    executor,
    moduleSm3: sm3For,
    withRows: options.withRows,
    holder: options.holder,
    minCell: options.context.minCell,
  });
}
