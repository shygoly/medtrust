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
import type { RwsAnalysis } from '../domain/types';
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
import type { PlanTemplate, TemplateRegistry } from '@medtrust/space-kernel-spi';

/** 已迁到 MDOP 的分析类型  计划模板 id（未列入者回落旧执行器）。 */
const TEMPLATE_ID_BY_TYPE: Readonly<Record<string, string>> = {
  'adverse-event-signal': 'rws.adverse-event-signal',
  'cohort-count': 'rws.cohort-count',
  'condition-prevalence': 'rws.condition-prevalence',
};

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

  constructor(private readonly context: MdopLocalRunContext) {
    registerMedTemplates(this.registry);
  }

  planFor(analysis: RwsAnalysis, _taskId: string): MdopLocalPlan | undefined {
    const templateId = TEMPLATE_ID_BY_TYPE[analysis.type];
    if (!templateId) return undefined; // 未迁移：交给调用方回落旧执行器
    const template = this.registry.resolve(templateId);
    if (!template) return undefined;
    const ctx = this.context;
    const draft = template.build(
      {
        purpose: ctx.purpose ?? '本地执行',
        applicant: { org: ctx.participantId, project: 'local' },
        contracts: [ctx.contractId],
        holders: [{ participantId: ctx.participantId, dataProductId: ctx.dataProductId }],
        ...(analysis.drug ?? ctx.drug ? { drug: analysis.drug ?? ctx.drug } : {}),
        ...(ctx.categoryKeys?.length ? { categoryKeys: ctx.categoryKeys } : {}),
        ...(ctx.minCell !== undefined ? { minCell: ctx.minCell } : {}),
        notBefore: new Date(0).toISOString(),
        notAfter: new Date(Date.now() + 86_400_000).toISOString(),
        ...(analysis.stratifyBy?.length ? { strataKeys: analysis.stratifyBy } : {}),
      },
      { spaceId: ctx.spaceId },
    ) as {
      stages: Array<{ id: string; op: string; params: Record<string, unknown> }>;
    };
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

  project(plan: MdopLocalPlan, rows: readonly unknown[]): Record<string, unknown> {
    // 本地存储的行用 `subjectKey`，MDOP 投影面用 `linkKey` —— 这一层名差属组装根知识，
    // 在此补齐（两边的其余字段同名直通）。
    const upstream = {
      rows: rows.map((r) => {
        const row = r as Record<string, unknown>;
        return typeof row.linkKey === 'string' ? row : { ...row, linkKey: row.subjectKey };
      }),
    };
    const { kind, field, emptyPlaceholder, filter } = plan.projection;
    if (kind === 'ae-signal') return aeSignalProjection(upstream, field, filter);
    if (kind === 'scalar-category') return scalarCategoryProjection(upstream, field, filter);
    return listCategoriesProjection(upstream, field, emptyPlaceholder ?? '', filter);
  }
}

/** 组装一个本地（单进程）MDOP RWS 执行器：节点执行面 + 计划端口 + 旧执行器兜底。 */
export function createMdopRwsExecutor(options: {
  legacy: ConstructorParameters<typeof MdopRwsExecutor>[0]['legacy'];
  context: MdopLocalRunContext;
  moduleDir: string;
  withRows<T>(fn: (rows: readonly unknown[]) => T): T;
  holder: string;
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
  const port = new MedMdopRwsPlanPort(options.context);
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
