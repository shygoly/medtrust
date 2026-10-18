import type { FormField } from '@medtrust/chat-cards';
import type { SpaceDirectory } from './directory';
import type { AssistantIntent } from './assistant-intent';

/**
 * 场景即数据：新增场景只在这里加一条，不改 agent 核心、不改 controller、不改 Card 渲染器。
 */
export type SubmitMode = 'direct' | 'template';

export const PURPOSE_CODES = {
  AI_CHAT_TASK_CONFIG: '对话式任务配置（AI Chat Agent）',
  DRUG_REGISTRATION: 'drug-registration',
} as const;
export type PurposeCode = (typeof PURPOSE_CODES)[keyof typeof PURPOSE_CODES];

export interface PurposePolicy {
  default: PurposeCode;
  allowed: readonly PurposeCode[];
}

export interface ContractDependencySpec {
  role: string;
  participantField: string;
  dataProductField: string;
  productRole: string;
}

export interface ContractRequestDefaults {
  retention: string;
  output: string;
  minCell: number;
  validDays: number;
}

export interface ProductRoleDefinition {
  catalogTags: string[];
  participantRoles: string[];
  projection: string;
}

export interface ScenarioDefaults {
  purpose: string;
  applicant: { org: string; project: string };
  contracts: string[];
  notBefore: string;
  notAfter: string;
  minCell: number;
  teeNode: string;
}

export interface ScenarioBuildContext {
  spaceId: string;
  userId: string;
  directory: SpaceDirectory;
  defaults: ScenarioDefaults;
}

export interface ScenarioSubmission {
  scenarioId: string;
  mode: SubmitMode;
  /** direct：直提路径（相对 API 前缀） */
  endpoint?: string;
  /** template：模板 id，两步提交（plans/preview → jobs） */
  template?: string;
  /** 台账归属键（通用 /mdop/jobs 入口必填） */
  analysisKey: string;
  /** direct 模式的请求体 */
  payload?: Record<string, unknown>;
  /** template 模式的模板入参 */
  templateInput?: Record<string, unknown>;
}

export interface ScenarioDefinition {
  id: string;
  assistantIntent: AssistantIntent;
  toolName: string;
  title: string;
  template: string;
  analysisKey: string;
  endpoint: string | null;
  mode: SubmitMode;
  description: string;
  keywords: string[];
  examples: string[];
  purposePolicy: PurposePolicy;
  contractDependencies: ContractDependencySpec[];
  contractRequestDefaults: ContractRequestDefaults;
  productRoles: Record<string, ProductRoleDefinition>;
  buildFields(ctx: ScenarioBuildContext): FormField[];
  buildSubmission(
    values: Record<string, unknown>,
    ctx: ScenarioBuildContext,
  ): { submission: ScenarioSubmission; warnings: string[] };
  /** 逐字段校验之外的跨字段校验 */
  validate(values: Record<string, unknown>, ctx: ScenarioBuildContext): string[];
}

// ───────────────────────── 小工具 ─────────────────────────

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};
const csv = (value: unknown): string[] =>
  str(value)
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const defaultContractRequest: ContractRequestDefaults = {
  retention: '作业完成后 30 天',
  output: '仅聚合统计',
  minCell: 5,
  validDays: 30,
};

const participantOptions = (ctx: ScenarioBuildContext, productRole?: string) => {
  if (!productRole) return ctx.directory.participants.map((p) => ({ label: p.name, value: p.id }));
  const roleProducts = ctx.directory.dataProducts.filter((product) =>
    product.roles?.includes(productRole),
  );
  if (roleProducts.length === 0)
    return ctx.directory.participants.map((p) => ({ label: p.name, value: p.id }));
  const ownerIds = new Set(roleProducts.map((product) => product.ownerId).filter(Boolean));
  return ctx.directory.participants
    .filter((participant) => ownerIds.has(participant.id))
    .map((p) => ({ label: p.name, value: p.id }));
};

const dataProductOptions = (ctx: ScenarioBuildContext, productRole?: string) => {
  const products = productRole
    ? ctx.directory.dataProducts.filter((product) => product.roles?.includes(productRole))
    : ctx.directory.dataProducts;
  // 目录尚未声明角色时保留全部候选，让用户显式选择；提交后的依赖仍由场景声明生成。
  return (products.length > 0 ? products : ctx.directory.dataProducts).map((p) => ({
    label: p.name,
    value: p.id,
  }));
};

const participantField = (
  name: string,
  label: string,
  ctx: ScenarioBuildContext,
  productRole?: string,
  over: Partial<FormField> = {},
): FormField => ({
  name,
  label,
  type: 'select',
  required: true,
  options: participantOptions(ctx, productRole),
  ...over,
});

const dataProductField = (
  name: string,
  label: string,
  ctx: ScenarioBuildContext,
  productRole?: string,
  over: Partial<FormField> = {},
): FormField => ({
  name,
  label,
  type: 'select',
  required: true,
  options: dataProductOptions(ctx, productRole),
  ...over,
});

/**
 * 多值字段（逗号分隔的参与方/数据产品）的目录提示。
 *
 * Card 协议只定义了 text|number|select|date|checkbox（spec §7.3），没有多选；
 * 多值场景用文本 + 目录提示，至少让用户知道该填哪些 id，而不是凭空猜。
 */
export function directoryHelp(
  ctx: ScenarioBuildContext,
  kind: 'participants' | 'data-products',
): string {
  const items = kind === 'participants' ? ctx.directory.participants : ctx.directory.dataProducts;
  if (items.length === 0) return '';
  const shown = items
    .slice(0, 8)
    .map((item) => `${item.id}（${item.name}）`)
    .join('、');
  return `目录可用：${shown}${items.length > 8 ? ' 等' : ''}`;
}

export const STRATA_FIELD: FormField = {
  name: 'strataKeys',
  label: '分层键',
  type: 'text',
  required: true,
  placeholder: '<40|M, 40+|F',
  help: '按年龄带与性别分层，多个用逗号分隔',
  validation: {
    pattern: '^[^,]+(,\\s*[^,]+)*$',
    message: '分层键请用逗号分隔，例如：<40|M, 40+|F',
  },
};

/** 把逗号分隔的「参与方 / 数据产品」对齐成 API 要求的成对数组。 */
export function pairParticipants(
  participants: string[],
  dataProducts: string[],
): Array<{ participantId: string; dataProductId: string }> {
  return participants.map((participantId, index) => ({
    participantId,
    dataProductId: dataProducts[index] ?? dataProducts[0] ?? '',
  }));
}

function governancePayload(ctx: ScenarioBuildContext, purpose: PurposeCode) {
  return {
    purpose,
    applicant: ctx.defaults.applicant,
    contracts: ctx.defaults.contracts,
    notBefore: ctx.defaults.notBefore,
    notAfter: ctx.defaults.notAfter,
  };
}

// ───────────────────────── 医疗场景 ─────────────────────────

const externalControl: ScenarioDefinition = {
  id: 'external-control',
  assistantIntent: 'access-contract',
  toolName: 'submit_external_control',
  title: '单臂试验外部对照',
  template: 'rws.external-control',
  analysisKey: 'mdop.external-control',
  endpoint: '/mdop/jobs/external-control',
  mode: 'direct',
  description:
    '试验组与对照组按分层键（年龄带×性别）在节点内匹配，卡尺限制匹配距离，比率 K:1，结果只回小单元格以上的聚合。',
  keywords: ['单臂', '外部对照', '对照', '匹配', '卡尺', '疗效对比', '试验组', '对照组', 'external control'],
  examples: ['我想对比试验组和对照组的疗效', '做单臂试验的外部对照'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG, PURPOSE_CODES.DRUG_REGISTRATION],
  },
  contractDependencies: [
    {
      role: 'trial',
      participantField: 'trial',
      dataProductField: 'trialDataProduct',
      productRole: 'sponsor-trial',
    },
    {
      role: 'controls',
      participantField: 'controls',
      dataProductField: 'controlsDataProduct',
      productRole: 'hospital-controls',
    },
  ],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    trial: {
      catalogTags: ['sponsor-trial'],
      participantRoles: ['sponsor'],
      projection: 'sponsor-trial',
    },
    controls: {
      catalogTags: ['hospital-controls'],
      participantRoles: ['provider'],
      projection: 'hospital-controls',
    },
  },
  buildFields(ctx) {
    return [
      participantField('trial', '试验方', ctx, 'sponsor-trial'),
      dataProductField('trialDataProduct', '试验方数据产品', ctx, 'sponsor-trial'),
      participantField('controls', '对照方', ctx, 'hospital-controls'),
      dataProductField('controlsDataProduct', '对照方数据产品', ctx, 'hospital-controls'),
      {
        name: 'teeNode',
        label: '可信执行节点',
        type: 'text',
        help: '匹配在节点内完成，平台看不到行级数据',
        defaultValue: ctx.defaults.teeNode,
      },
      STRATA_FIELD,
      {
        name: 'caliperDays',
        label: '卡尺天数',
        type: 'number',
        defaultValue: 30,
        validation: { min: 1, max: 365 },
      },
      {
        name: 'ratioK',
        label: '匹配比例',
        type: 'number',
        defaultValue: 2,
        help: '对照:试验 = K:1',
        validation: { min: 1, max: 10 },
      },
    ];
  },
  validate(values) {
    const errors: string[] = [];
    const trial = str(values.trial);
    const controls = str(values.controls);
    if (trial && controls && trial === controls)
      errors.push('试验方与对照方不能是同一参与方');
    if (csv(values.strataKeys).length === 0) errors.push('至少需要一个分层键');
    return errors;
  },
  buildSubmission(values, ctx) {
    return {
      submission: {
        scenarioId: this.id,
        mode: 'direct',
        endpoint: this.endpoint ?? undefined,
        analysisKey: this.analysisKey,
        payload: {
          ...governancePayload(ctx, this.purposePolicy.default),
          trial: { participantId: str(values.trial), dataProductId: str(values.trialDataProduct) },
          controls: {
            participantId: str(values.controls),
            dataProductId: str(values.controlsDataProduct),
          },
          teeNode: str(values.teeNode) || ctx.defaults.teeNode,
          strataKeys: csv(values.strataKeys),
          caliperDays: num(values.caliperDays) ?? 30,
          ratioK: num(values.ratioK) ?? 2,
          minCell: ctx.defaults.minCell,
        },
      },
      warnings: [],
    };
  },
};

const flPrediction: ScenarioDefinition = {
  id: 'fl-prediction',
  assistantIntent: 'access-contract',
  toolName: 'submit_fl_prediction',
  title: 'L4 联邦学习预测',
  template: 'rws.l4.fl-prediction',
  analysisKey: 'fl.l4-prediction',
  endpoint: '/mdop/jobs/fl-prediction',
  mode: 'direct',
  description:
    '多方各院本地训练，平台只合并模型更新（FedAvg），原始数据与中间更新不出院。至少 2 方参与。',
  keywords: ['联邦学习', '联邦', 'l4', '多方训练', '预测模型', '联合建模', 'fl', 'federated'],
  examples: ['我有两家医院的数据，想做预测模型', '用联邦学习训练一个风险预测模型'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG],
  },
  contractDependencies: [],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    source: {
      catalogTags: ['federated-source'],
      participantRoles: ['provider'],
      projection: 'federated-source',
    },
  },
  buildFields(ctx) {
    return [
      {
        name: 'hospitals',
        label: '参与方',
        type: 'text',
        required: true,
        placeholder: 'p-hosp-a, p-hosp-b',
        help: ['至少 2 方，用逗号分隔', directoryHelp(ctx, 'participants')]
          .filter(Boolean)
          .join('；'),
      },
      {
        name: 'dataProducts',
        label: '数据产品',
        type: 'text',
        required: true,
        placeholder: 'dp-hosp-a, dp-hosp-b',
        help: '与参与方一一对应；只填一个时全部复用',
      },
      { name: 'target', label: '预测目标字段', type: 'text', required: true, placeholder: 'label_diabetes' },
      {
        name: 'model',
        label: '模型',
        type: 'select',
        defaultValue: 'logistic_regression',
        options: [{ label: '逻辑回归（本期唯一支持）', value: 'logistic_regression' }],
      },
      { name: 'rounds', label: '训练轮次', type: 'number', defaultValue: 3, validation: { min: 1, max: 100 } },
    ];
  },
  validate(values) {
    const hospitals = csv(values.hospitals);
    if (hospitals.length < 2) return ['联邦学习至少需要 2 方参与'];
    if (csv(values.dataProducts).length === 0) return ['至少需要一个数据产品'];
    return [];
  },
  buildSubmission(values, ctx) {
    const hospitals = csv(values.hospitals);
    const dataProducts = csv(values.dataProducts);
    return {
      submission: {
        scenarioId: this.id,
        mode: 'direct',
        endpoint: this.endpoint ?? undefined,
        analysisKey: this.analysisKey,
        payload: {
          ...governancePayload(ctx, this.purposePolicy.default),
          hospitals: pairParticipants(hospitals, dataProducts),
          spec: {
            model: str(values.model) || 'logistic_regression',
            rounds: num(values.rounds) ?? 3,
            target: str(values.target),
          },
          minCell: ctx.defaults.minCell,
        },
      },
      warnings: [],
    };
  },
};

const cohortCount: ScenarioDefinition = {
  id: 'cohort-count',
  assistantIntent: 'access-contract',
  toolName: 'submit_cohort_count',
  title: '队列规模统计',
  template: 'rws.cohort-count',
  analysisKey: 'mdop.cohort-count',
  endpoint: '/mdop/jobs/cohort-count',
  mode: 'direct',
  description: '各院按分层键做去重计数，平台按分类键相加；只回小单元格以上的计数。',
  keywords: ['队列', '计数', '规模', '有多少人', '患病人数', '现患', 'cohort count'],
  examples: ['统计一下两院各年龄段的患病人数'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG],
  },
  contractDependencies: [],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    cohort: {
      catalogTags: ['cohort'],
      participantRoles: ['provider'],
      projection: 'cohort',
    },
  },
  buildFields(ctx) {
    return [
      {
        name: 'holders',
        label: '数据持有方',
        type: 'text',
        required: true,
        placeholder: 'p-hosp-a, p-hosp-b',
        help: ['用逗号分隔', directoryHelp(ctx, 'participants')].filter(Boolean).join('；'),
      },
      {
        name: 'dataProducts',
        label: '数据产品',
        type: 'text',
        required: true,
        placeholder: 'dp-cohort-a, dp-cohort-b',
        help: '与数据持有方一一对应；只填一个时全部复用',
      },
      { ...STRATA_FIELD, required: false },
      { name: 'drug', label: '药品过滤（可选）', type: 'text', placeholder: 'metformin' },
    ];
  },
  validate(values) {
    return csv(values.holders).length === 0 ? ['至少需要一个数据持有方'] : [];
  },
  buildSubmission(values, ctx) {
    return {
      submission: {
        scenarioId: this.id,
        mode: 'direct',
        endpoint: this.endpoint ?? undefined,
        analysisKey: this.analysisKey,
        payload: {
          ...governancePayload(ctx, this.purposePolicy.default),
          holders: pairParticipants(csv(values.holders), csv(values.dataProducts)),
          ...(csv(values.strataKeys).length ? { strataKeys: csv(values.strataKeys) } : {}),
          ...(str(values.drug) ? { drug: str(values.drug) } : {}),
          minCell: ctx.defaults.minCell,
        },
      },
      warnings: [],
    };
  },
};

// ───────────────────────── 电力场景 ─────────────────────────

const loadForecast: ScenarioDefinition = {
  id: 'load-forecast',
  assistantIntent: 'access-contract',
  toolName: 'submit_load_forecast',
  title: '电力负荷预测',
  template: 'power.load-forecast',
  analysisKey: 'power.load-forecast',
  endpoint: null,
  mode: 'template',
  description:
    '各方在节点内提取特征并降密为节点级聚合，平台按样本量加权合并；预测时长 1-168 小时。',
  keywords: ['负荷预测', '电力负荷', '用电预测', '明天负荷', '预测负荷', 'load forecast'],
  examples: ['我想预测明天的电力负荷'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG],
  },
  contractDependencies: [],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    grid: {
      catalogTags: ['power-grid'],
      participantRoles: ['provider'],
      projection: 'power-grid',
    },
  },
  buildFields(ctx) {
    return [
      {
        name: 'participants',
        label: '参与方',
        type: 'text',
        required: true,
        placeholder: 'p-grid-a, p-grid-b',
        help: ['至少 2 方（电网 / 气象 / 工业），用逗号分隔', directoryHelp(ctx, 'participants')]
          .filter(Boolean)
          .join('；'),
      },
      {
        name: 'dataProducts',
        label: '数据产品',
        type: 'text',
        required: true,
        placeholder: 'dp-load-a, dp-load-b',
        help: '与参与方一一对应；只填一个时全部复用',
      },
      {
        name: 'role',
        label: '参与方角色',
        type: 'select',
        defaultValue: 'grid',
        options: [
          { label: '电网（grid）', value: 'grid' },
          { label: '气象（weather）', value: 'weather' },
          { label: '工业用户（industrial）', value: 'industrial' },
        ],
      },
      {
        name: 'forecastHorizon',
        label: '预测时长（小时）',
        type: 'number',
        defaultValue: 24,
        validation: { min: 1, max: 168 },
      },
      {
        name: 'features',
        label: '特征列',
        type: 'text',
        defaultValue: 'load, temperature',
        help: '逗号分隔',
      },
      {
        name: 'model',
        label: '预测模型',
        type: 'select',
        defaultValue: 'baseline',
        options: [{ label: '季节朴素基线（已实现）', value: 'baseline' }],
        help: 'lstm / transformer 尚未接入，提交会被拒',
      },
    ];
  },
  validate(values) {
    const participants = csv(values.participants);
    if (participants.length < 2) return ['负荷预测至少需要 2 方参与'];
    if (csv(values.features).length === 0) return ['至少需要一个特征'];
    return [];
  },
  buildSubmission(values, ctx) {
    const participants = csv(values.participants);
    const dataProducts = csv(values.dataProducts);
    const role = str(values.role) || 'grid';
    return {
      submission: {
        scenarioId: this.id,
        mode: 'template',
        template: this.template,
        analysisKey: this.analysisKey,
        templateInput: {
          ...governancePayload(ctx, this.purposePolicy.default),
          participants: pairParticipants(participants, dataProducts).map((pair) => ({
            ...pair,
            role,
          })),
          spec: {
            forecastHorizon: num(values.forecastHorizon) ?? 24,
            features: csv(values.features),
            model: str(values.model) || 'baseline',
          },
        },
      },
      warnings: [],
    };
  },
};

const demandResponse: ScenarioDefinition = {
  id: 'demand-response',
  assistantIntent: 'access-contract',
  toolName: 'submit_demand_response',
  title: '需求响应优化',
  template: 'power.demand-response',
  analysisKey: 'power.demand-response',
  endpoint: null,
  mode: 'template',
  description: '按目标负荷曲线与激励预算在参与方之间分配削峰 / 转移潜力，输出调度建议。',
  keywords: ['需求响应', '削峰填谷', '负荷调度', '响应', 'demand response'],
  examples: ['帮我做削峰填谷的需求响应优化'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG],
  },
  contractDependencies: [],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    grid: {
      catalogTags: ['power-grid'],
      participantRoles: ['provider'],
      projection: 'power-grid',
    },
  },
  buildFields(ctx) {
    return [
      {
        name: 'participants',
        label: '参与方',
        type: 'text',
        required: true,
        placeholder: 'p-grid-a, p-grid-b',
        help: ['至少 2 方，用逗号分隔', directoryHelp(ctx, 'participants')]
          .filter(Boolean)
          .join('；'),
      },
      {
        name: 'dataProducts',
        label: '数据产品',
        type: 'text',
        required: true,
        help: ['与参与方一一对应；只填一个时全部复用', directoryHelp(ctx, 'data-products')]
          .filter(Boolean)
          .join('；'),
      },
      {
        name: 'userType',
        label: '用户类型',
        type: 'select',
        defaultValue: 'industrial',
        options: [
          { label: '工业（industrial）', value: 'industrial' },
          { label: '商业（commercial）', value: 'commercial' },
          { label: '居民（residential）', value: 'residential' },
        ],
      },
      {
        name: 'targetLoad',
        label: '目标负荷曲线（24 小时，kW）',
        type: 'text',
        required: true,
        placeholder: '100, 95, 90, ...（共 24 个数字）',
        help: '逗号分隔的 24 个数字',
      },
      {
        name: 'incentiveBudget',
        label: '激励预算',
        type: 'number',
        required: true,
        validation: { min: 1 },
      },
      { name: 'windowStart', label: '响应窗口开始（小时）', type: 'number', defaultValue: 18, validation: { min: 0, max: 23 } },
      { name: 'windowEnd', label: '响应窗口结束（小时）', type: 'number', defaultValue: 22, validation: { min: 1, max: 24 } },
    ];
  },
  validate(values) {
    if (csv(values.participants).length < 2) return ['需求响应至少需要 2 方参与'];
    if (csv(values.targetLoad).length !== 24) return ['目标负荷曲线必须包含 24 个小时值'];
    const start = num(values.windowStart) ?? 18;
    const end = num(values.windowEnd) ?? 22;
    if (start >= end) return ['响应窗口的开始必须早于结束'];
    return [];
  },
  buildSubmission(values, ctx) {
    const userType = str(values.userType) || 'industrial';
    return {
      submission: {
        scenarioId: this.id,
        mode: 'template',
        template: this.template,
        analysisKey: this.analysisKey,
        templateInput: {
          ...governancePayload(ctx, this.purposePolicy.default),
          participants: pairParticipants(csv(values.participants), csv(values.dataProducts)).map(
            (pair) => ({ ...pair, userType }),
          ),
          spec: {
            targetLoad: csv(values.targetLoad).map((item) => Number(item)),
            incentiveBudget: num(values.incentiveBudget) ?? 0,
            timeWindow: [num(values.windowStart) ?? 18, num(values.windowEnd) ?? 22],
          },
        },
      },
      warnings: [],
    };
  },
};

const theftDetection: ScenarioDefinition = {
  id: 'theft-detection',
  assistantIntent: 'access-contract',
  toolName: 'submit_theft_detection',
  title: '跨区域窃电检测',
  template: 'power.theft-detection',
  analysisKey: 'power.theft-detection',
  endpoint: null,
  mode: 'template',
  description: '多方各自计算异常分数，平台聚合 TopK 名单；检测周期至少 30 天。',
  keywords: ['窃电', '异常用电', '偷电', '线损', 'theft'],
  examples: ['检测一下跨区域的异常用电'],
  purposePolicy: {
    default: PURPOSE_CODES.AI_CHAT_TASK_CONFIG,
    allowed: [PURPOSE_CODES.AI_CHAT_TASK_CONFIG],
  },
  contractDependencies: [],
  contractRequestDefaults: { ...defaultContractRequest },
  productRoles: {
    grid: {
      catalogTags: ['power-grid'],
      participantRoles: ['provider'],
      projection: 'power-grid',
    },
  },
  buildFields(ctx) {
    return [
      {
        name: 'participants',
        label: '参与方',
        type: 'text',
        required: true,
        placeholder: 'p-grid-a, p-grid-b',
        help: ['至少 2 个供电局，用逗号分隔', directoryHelp(ctx, 'participants')]
          .filter(Boolean)
          .join('；'),
      },
      {
        name: 'dataProducts',
        label: '数据产品',
        type: 'text',
        required: true,
        help: '与参与方一一对应；只填一个时全部复用',
      },
      {
        name: 'detectionPeriod',
        label: '检测周期（天）',
        type: 'number',
        defaultValue: 30,
        validation: { min: 30, max: 365 },
      },
      {
        name: 'anomalyThreshold',
        label: '异常阈值',
        type: 'number',
        defaultValue: 0.8,
        validation: { min: 0, max: 1 },
      },
      { name: 'topK', label: 'TopK 名单长度', type: 'number', defaultValue: 10, validation: { min: 1, max: 1000 } },
    ];
  },
  validate(values) {
    return csv(values.participants).length < 2 ? ['窃电检测至少需要 2 个供电局参与'] : [];
  },
  buildSubmission(values, ctx) {
    return {
      submission: {
        scenarioId: this.id,
        mode: 'template',
        template: this.template,
        analysisKey: this.analysisKey,
        templateInput: {
          ...governancePayload(ctx, this.purposePolicy.default),
          participants: pairParticipants(csv(values.participants), csv(values.dataProducts)),
          spec: {
            detectionPeriod: num(values.detectionPeriod) ?? 30,
            anomalyThreshold: num(values.anomalyThreshold) ?? 0.8,
            topK: num(values.topK) ?? 10,
          },
        },
      },
      warnings: [],
    };
  },
};

export const SCENARIOS: ScenarioDefinition[] = [
  externalControl,
  flPrediction,
  cohortCount,
  loadForecast,
  demandResponse,
  theftDetection,
];

export function findScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function findScenarioByToolName(toolName: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenario) => scenario.toolName === toolName);
}
