import type { CardMessage } from '@medtrust/chat-cards';

export const ASSISTANT_INTENTS = [
  'study-design',
  'access-contract',
  'result-interpretation',
  'platform-ops',
  'compliance-evidence',
  'hospital-mapping',
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];
export type AssistantRole = 'provider' | 'consumer' | 'operator' | 'compliance' | 'admin';
export type DataAccessLevel = 'none' | 'metadata-only' | 'aggregate-only';

export interface AssistantDefinition {
  intent: AssistantIntent;
  title: string;
  summary: string;
  systemPromptId: string;
  audience: string[];
  roles: AssistantRole[];
  dataAccess: DataAccessLevel;
  allowedTools: string[];
  outputSchema: 'study-draft/v1' | 'contract-bundle/v1' | 'result-draft/v1' | 'ops-diagnosis/v1' | 'evidence-index/v1' | 'mapping-draft/v1';
  confirmation: 'none' | 'before-freeze' | 'before-request' | 'before-change';
  auditTag: string;
  promptKeywords: string[];
}

/** 每个助手独立声明工具与人工确认点；路由本身不扩大权限。 */
export const ASSISTANT_CONFIGS: Record<AssistantIntent, AssistantDefinition> = {
  'study-design': {
    intent: 'study-design',
    title: '研究设计与可行性助手',
    summary: '根据目录元数据整理研究问题、候选数据产品、假设、缺口与 Protocol/SAP 草稿。',
    systemPromptId: 'assistant.study-design.v1',
    audience: ['药企医学', 'RWE', '注册人员'],
    roles: ['consumer', 'operator'],
    dataAccess: 'metadata-only',
    allowedTools: ['list_participants', 'list_scenarios', 'compare_scenarios', 'refresh_scenario_card'],
    outputSchema: 'study-draft/v1',
    confirmation: 'before-freeze',
    auditTag: 'ai.assistant.study-design',
    promptKeywords: ['研究设计', '方案', '可行性', 'protocol', 'sap', '候选数据', '研究问题'],
  },
  'access-contract': {
    intent: 'access-contract',
    title: '访问与合约编排助手',
    summary: '按场景和用户选择生成多数据源合约矩阵、申请卡、审批状态与作业草稿。',
    systemPromptId: 'assistant.access-contract.v1',
    audience: ['药企研究运营', '医院合约管理员'],
    roles: ['consumer', 'provider', 'operator'],
    dataAccess: 'metadata-only',
    allowedTools: [
      'list_participants',
      'list_scenarios',
      'compare_scenarios',
      'check_space_membership',
      'check_data_access',
      'check_contract_status',
      'request_contract',
      'list_contract_requests',
      'refresh_scenario_card',
      'submit_external_control',
      'draft_registration_study',
      'validate_registration_profile',
      'resolve_registration_sources',
      'review_registration_plan',
      'prepare_synthetic_registration',
      'submit_external_control_registration',
      'get_registration_job',
      'build_registration_report',
      'download_registration_report',
      'submit_fl_prediction',
      'submit_cohort_count',
      'submit_load_forecast',
      'submit_demand_response',
      'submit_theft_detection',
    ],
    outputSchema: 'contract-bundle/v1',
    confirmation: 'before-request',
    auditTag: 'ai.assistant.access-contract',
    promptKeywords: [
      '合约',
      '合同',
      '申请',
      '授权',
      '审批',
      '签约',
      '访问权',
      '提交作业',
      '参数卡',
      '外部对照',
      '注册研究',
      '注册型外部对照',
      '注册报告',
      'estimand',
      'target trial',
      '单臂',
      '试验组',
      '对照组',
      '联邦学习',
      '队列',
      '计数',
      '统计',
      '人数',
      '负荷',
      '电力',
      '预测',
      '需求响应',
      '窃电',
      '异常用电',
      '用电',
    ],
  },
  'result-interpretation': {
    intent: 'result-interpretation',
    title: '结果解读助手',
    summary: '只处理已发布 C3 白名单结果，数字由服务端回查，输出待确认研究解读草稿。',
    systemPromptId: 'assistant.result-interpretation.v1',
    audience: ['药企统计', '医学', '研究者'],
    roles: ['consumer', 'provider', 'compliance', 'operator'],
    dataAccess: 'aggregate-only',
    allowedTools: ['list_participants'],
    outputSchema: 'result-draft/v1',
    confirmation: 'none',
    auditTag: 'ai.assistant.result-interpretation',
    promptKeywords: ['解释结果', '解读结果', 'C3', '统计结果', '结论', '怎么看', '结果说明'],
  },
  'platform-ops': {
    intent: 'platform-ops',
    title: '平台运维助手',
    summary: '只读任务状态、心跳、证明有效期、审计摘要与错误码，输出排障建议。',
    systemPromptId: 'assistant.platform-ops.v1',
    audience: ['空间运营', '平台运维'],
    roles: ['operator', 'admin'],
    dataAccess: 'metadata-only',
    allowedTools: ['list_participants', 'list_scenarios'],
    outputSchema: 'ops-diagnosis/v1',
    confirmation: 'before-change',
    auditTag: 'ai.assistant.platform-ops',
    promptKeywords: ['运维', '心跳', '连接器离线', '错误码', '证明有效期', '排查', '任务卡住', '发布检查'],
  },
  'compliance-evidence': {
    intent: 'compliance-evidence',
    title: '合规与监管证据助手',
    summary: '组织规则、合约、凭证、已发布结果与证据缺口，不生成最终合规或监管结论。',
    systemPromptId: 'assistant.compliance-evidence.v1',
    audience: ['合规', '监管', '注册人员'],
    roles: ['compliance', 'operator', 'admin'],
    dataAccess: 'metadata-only',
    allowedTools: ['list_participants', 'list_contract_requests', 'check_contract_status'],
    outputSchema: 'evidence-index/v1',
    confirmation: 'none',
    auditTag: 'ai.assistant.compliance-evidence',
    promptKeywords: ['合规证据', '监管材料', '证据索引', '审计证据', '预审材料', '规则映射', '缺口清单'],
  },
  'hospital-mapping': {
    intent: 'hospital-mapping',
    title: '医院码表与接入助手',
    summary: '只处理字段名、码表、版本与本体映射，输出映射契约草案。',
    systemPromptId: 'assistant.hospital-mapping.v1',
    audience: ['医院信息科', '数据管理员'],
    roles: ['provider', 'operator', 'admin'],
    dataAccess: 'metadata-only',
    allowedTools: ['list_participants'],
    outputSchema: 'mapping-draft/v1',
    confirmation: 'before-freeze',
    auditTag: 'ai.assistant.hospital-mapping',
    promptKeywords: ['码表', '字段映射', '本体映射', '字段名', '版本', '数据接入', '连接器接入'],
  },
};

export interface IntentRouteInput {
  message: string;
  role?: string;
  page?: string;
  draftIntent?: AssistantIntent;
  explicitIntent?: AssistantIntent;
}

export interface IntentCandidate {
  intent: AssistantIntent;
  score: number;
  evidence: string[];
}

export interface IntentRouteResult {
  primary: AssistantIntent;
  alternates: AssistantIntent[];
  confidence: 'high' | 'low';
  reason: string[];
  requiresSelection: boolean;
  candidates: IntentCandidate[];
}

function isIntent(value: unknown): value is AssistantIntent {
  return typeof value === 'string' && (ASSISTANT_INTENTS as readonly string[]).includes(value);
}

function allowedForRole(intent: AssistantIntent, role?: string): boolean {
  if (!role) return true;
  return (ASSISTANT_CONFIGS[intent].roles as readonly string[]).includes(role);
}

/**
 * 规则优先：显式选择 > 当前页面 > 已确认草稿 > 明确关键词。
 * 规则不能唯一判断时返回选择卡，不调用 LLM 猜测。
 */
export function routeAssistantIntent(input: IntentRouteInput): IntentRouteResult {
  if (isIntent(input.explicitIntent)) {
    const explicit = input.explicitIntent;
    if (!allowedForRole(explicit, input.role)) {
      return {
        primary: 'study-design',
        alternates: [],
        confidence: 'low',
        reason: [`当前角色 ${input.role ?? '未知'} 无权进入 ${explicit}`],
        requiresSelection: true,
        candidates: [],
      };
    }
    return {
      primary: explicit,
      alternates: [],
      confidence: 'high',
      reason: ['用户显式选择'],
      requiresSelection: false,
      candidates: [{ intent: explicit, score: 100, evidence: ['explicit'] }],
    };
  }

  const page = input.page ?? '';
  const pageRule: Array<[RegExp, AssistantIntent]> = [
    [/\/space\/contracts|\/space\/catalog/, 'access-contract'],
    [/\/space\/mdop\/jobs\/|\/space\/tasks\//, 'result-interpretation'],
    [/\/space\/audit|\/space\/compliance/, 'compliance-evidence'],
    [/\/space\/connectors|\/space\/admin\/system/, 'platform-ops'],
  ];
  const pageIntent = pageRule.find(([pattern]) => pattern.test(page))?.[1];
  if (pageIntent && allowedForRole(pageIntent, input.role)) {
    return {
      primary: pageIntent,
      alternates: [],
      confidence: 'high',
      reason: [`当前页面 ${page}`],
      requiresSelection: false,
      candidates: [{ intent: pageIntent, score: 50, evidence: [page] }],
    };
  }

  const text = input.message.toLowerCase();
  const candidates: IntentCandidate[] = ASSISTANT_INTENTS.map((intent) => {
    const words = ASSISTANT_CONFIGS[intent].promptKeywords.filter((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    const score = words.reduce((sum, keyword) => sum + Math.max(1, keyword.length), 0);
    return { intent, score, evidence: words };
  })
    .filter((candidate) => candidate.score > 0 && allowedForRole(candidate.intent, input.role))
    .sort((a, b) => b.score - a.score || ASSISTANT_INTENTS.indexOf(a.intent) - ASSISTANT_INTENTS.indexOf(b.intent));

  if (candidates.length === 0 && input.draftIntent && allowedForRole(input.draftIntent, input.role)) {
    return {
      primary: input.draftIntent,
      alternates: [],
      confidence: 'high',
      reason: ['沿用当前会话已确认草稿'],
      requiresSelection: false,
      candidates: [{ intent: input.draftIntent, score: 1, evidence: ['draft'] }],
    };
  }

  if (candidates.length === 0) {
    return {
      primary: 'study-design',
      alternates: ASSISTANT_INTENTS.filter((intent) => allowedForRole(intent, input.role)).slice(0, 3),
      confidence: 'low',
      reason: ['没有足够规则证据'],
      requiresSelection: true,
      candidates: [],
    };
  }

  const top = candidates[0]!;
  const second = candidates[1];
  if (!second || top.score > second.score) {
    return {
      primary: top.intent,
      alternates: second ? [second.intent] : [],
      confidence: 'high',
      reason: [`关键词：${top.evidence.join('、')}`],
      requiresSelection: false,
      candidates,
    };
  }

  return {
    primary: top.intent,
    alternates: candidates.slice(1, 3).map((candidate) => candidate.intent),
    confidence: 'low',
    reason: ['多个意图得分相同，必须由用户选择'],
    requiresSelection: true,
    candidates,
  };
}

export function buildIntentSelectionCard(
  route: IntentRouteResult,
  role?: string,
): CardMessage {
  const available = (
    route.candidates.length > 0
      ? [...new Set([route.primary, ...route.alternates])]
      : ASSISTANT_INTENTS.filter((intent) => allowedForRole(intent, role))
  ).slice(0, 6);
  return {
    type: 'assistant_intent',
    title: '请选择要使用的助手',
    description: '这句话可能对应多个助手。选择后会在同一会话中保留已确认信息。',
    data: {
      options: available.map((intent) => ({
        intent,
        title: ASSISTANT_CONFIGS[intent].title,
        summary: ASSISTANT_CONFIGS[intent].summary,
      })),
      evidence: route.reason,
    },
  };
}

export function toolsForIntent(intent: AssistantIntent): Set<string> {
  return new Set(ASSISTANT_CONFIGS[intent].allowedTools);
}
