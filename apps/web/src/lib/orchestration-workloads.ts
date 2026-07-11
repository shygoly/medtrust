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

/** 可在 /space/tasks/new 发起的出站编排类型 */
export const ORCHESTRATION_WORKLOADS: OrchestrationWorkloadMeta[] = [
  {
    kind: 'rws',
    label: 'RWS 真实世界研究',
    shortLabel: 'RWS',
    kicker: 'L2–L3 · 队列统计',
    description: '多院连接器本地执行队列分析，仅聚合指标回传（cohort / 不良反应信号等）。',
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

export function mapOrchestrationStatus(s: string): 'completed' | 'running' | 'blocked' {
  const normalized = s.toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed' || normalized === 'refused' || normalized === 'partial') return 'blocked';
  return 'running';
}
