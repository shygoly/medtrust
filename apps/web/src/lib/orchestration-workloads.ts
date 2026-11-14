/** 控制面出站编排任务类型（RWS / L4 FL / SecretFlow 密算）。 */

export type OrchestrationWorkloadKind = 'rws' | 'fl_prediction' | 'secretflow';

export interface OrchestrationWorkloadMeta {
  kind: OrchestrationWorkloadKind;
  label: string;
  shortLabel: string;
  kicker: string;
  description: string;
  newPath: string;
  detailQuery: string;
}

/** 列表/详情用的 workload 元数据（按 kind 唯一）。 */
export const ORCHESTRATION_WORKLOADS: OrchestrationWorkloadMeta[] = [
  {
    kind: 'rws',
    label: 'RWS 真实世界研究',
    shortLabel: 'RWS',
    kicker: 'L0–L3 · 阶梯分析',
    description:
      '连接器本地执行：L0 算法核验、队列/不良反应、L1.5 失衡、L2 比较效果、L3 因果；仅聚合指标回传。',
    newPath: '/space/tasks/new/rws',
    detailQuery: 'rws',
  },
  {
    kind: 'fl_prediction',
    label: 'L4 联邦预测建模',
    shortLabel: 'L4 FL',
    kicker: 'L4 · 表格建模',
    description: 'structured_ehr 水平联邦训练（XGBoost / LR / RF），各方 party 结果在控制面合并。',
    newPath: '/space/tasks/new/fl-prediction',
    detailQuery: 'fl_prediction',
  },
];

/**
 * /space/tasks/new 发起入口卡片。L0 单独露出（仍属 RWS 编排，落地到 rws 表单并预选分析类型）。
 */
export const ORCHESTRATION_CREATE_OPTIONS: OrchestrationWorkloadMeta[] = [
  {
    kind: 'rws',
    label: 'L0 算法准确性验证',
    shortLabel: 'L0',
    kicker: 'L0 · Se/Sp 核验',
    description:
      '用金标准核验识别算法（如 panc-ae-term-v1）的 Se/Sp/PPV/NPV；按院分列，不做跨源平均。',
    newPath: '/space/tasks/new/rws?analysis=algorithm-validation',
    detailQuery: 'rws',
  },
  {
    ...ORCHESTRATION_WORKLOADS[0],
    kicker: 'L1–L3 · 阶梯分析',
    description:
      '队列统计、不良反应、L1.5 失衡、L2 比较效果、L3 因果。算法准确性核验请选左侧「L0」。',
  },
  ORCHESTRATION_WORKLOADS[1],
];

const SECRETFLOW_WORKLOAD_META: OrchestrationWorkloadMeta = {
  kind: 'secretflow',
  label: 'SecretFlow 联邦密算',
  shortLabel: 'SF',
  kicker: 'L3+ · LoRA',
  description: '多模态联邦微调（Meditron LoRA），Agent 派发 + FSM 聚合；详情在联邦密算页。',
  newPath: '/space/catalog',
  detailQuery: 'secretflow',
};

const ALL_WORKLOAD_METAS: OrchestrationWorkloadMeta[] = [
  ...ORCHESTRATION_WORKLOADS,
  SECRETFLOW_WORKLOAD_META,
];

export function workloadMeta(kind: OrchestrationWorkloadKind): OrchestrationWorkloadMeta {
  return ALL_WORKLOAD_METAS.find((w) => w.kind === kind) ?? ORCHESTRATION_WORKLOADS[0];
}

export interface UnifiedOrchestrationListItem {
  kind: OrchestrationWorkloadKind;
  taskId: string;
  title: string;
  purpose: string;
  status: string;
  consumerId: string;
  createdAt: string;
  providerCount: number;
  summary?: string;
  /** SecretFlow 等外链详情（不走 /space/tasks/[id]） */
  detailHref?: string;
}

export function orchestrationDetailHref(item: UnifiedOrchestrationListItem): string {
  if (item.detailHref) return item.detailHref;
  const meta = workloadMeta(item.kind);
  return `/space/tasks/${item.taskId}?workload=${meta.detailQuery}`;
}

/** 旧通道 / SecretFlow 状态 → 浏览四态（tasks-browse-status）。 */
export function mapOrchestrationStatus(
  s: string,
): 'completed' | 'running' | 'failed' | 'cancelled' {
  const normalized = s.toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed' || normalized === 'partial') return 'failed';
  if (
    normalized === 'refused' ||
    normalized === 'cancelled' ||
    normalized === 'aborted' ||
    normalized === 'rejected'
  ) {
    return 'cancelled';
  }
  return 'running';
}
