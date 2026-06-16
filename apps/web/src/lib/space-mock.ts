// Mock data for the 可信数据空间控制台 (federated data-space console).
// Stands in for the future connector / control-plane APIs so the UI is
// demonstrable before any backend exists. See openspec/changes/federated-data-space-rws.

export type ConnectorRole = "provider" | "consumer";
export type ConnectorStatus = "online" | "idle" | "offline";

export interface Connector {
  id: string;
  org: string;
  role: ConnectorRole;
  status: ConnectorStatus;
  region: string;
  certFingerprint: string;
  certValidUntil: string;
  datasetCount: number;
  recordCount: number;
  lastSeen: string;
  residency: string; // where the raw data physically lives
}

export type TaskStatus = "draft" | "awaiting-auth" | "running" | "completed" | "blocked";
export type WorkloadType = "rws" | "federated_learning" | "secretflow";

export interface TaskNodeRun {
  connectorId: string;
  org: string;
  state: "pending" | "authorized" | "executing" | "gate" | "returned" | "denied";
  progress: number; // 0-100
  note?: string;
}

export interface RwsTask {
  id: string;
  workloadType: WorkloadType;
  title: string;
  initiator: string; // pharma org
  purpose: string;
  cohort: string;
  analysis: string;
  status: TaskStatus;
  createdAt: string;
  targets: TaskNodeRun[];
  output?: {
    kind: string;
    rowsSuppressed: number; // small-cell suppression count
    summary: string;
  };
  policy: UsagePolicy;
}

export interface UsagePolicy {
  purpose: string;
  retention: string; // e.g. 阅后即焚
  output: string; // e.g. 仅聚合
  validUntil: string;
}

export interface Attestation {
  id: string;
  txHash: string;
  taskId: string;
  taskTitle: string;
  kind: "policy" | "task" | "output";
  participants: string[];
  inputFingerprint: string;
  outputHash: string;
  block: number;
  at: string;
}

export const connectors: Connector[] = [
  {
    id: "cn-huashan",
    org: "华山医院",
    role: "provider",
    status: "online",
    region: "上海",
    certFingerprint: "SM2:9F:2A:C4:7E:11:DB:80:5C",
    certValidUntil: "2027-03-01",
    datasetCount: 12,
    recordCount: 184_300,
    lastSeen: "3 秒前",
    residency: "院内内网 · 数据不出域",
  },
  {
    id: "cn-ruijin",
    org: "瑞金医院",
    role: "provider",
    status: "online",
    region: "上海",
    certFingerprint: "SM2:3B:88:1F:A0:62:9C:4D:E2",
    certValidUntil: "2027-01-18",
    datasetCount: 9,
    recordCount: 151_220,
    lastSeen: "11 秒前",
    residency: "院内内网 · 数据不出域",
  },
  {
    id: "cn-zhongshan",
    org: "中山医院",
    role: "provider",
    status: "idle",
    region: "上海",
    certFingerprint: "SM2:7C:D5:90:33:AA:14:6B:F8",
    certValidUntil: "2026-11-09",
    datasetCount: 7,
    recordCount: 98_640,
    lastSeen: "6 分钟前",
    residency: "院内内网 · 数据不出域",
  },
  {
    id: "cn-hengrui",
    org: "恒瑞医药",
    role: "consumer",
    status: "online",
    region: "江苏",
    certFingerprint: "SM2:E1:40:7B:2C:55:9F:08:3A",
    certValidUntil: "2027-05-22",
    datasetCount: 0,
    recordCount: 0,
    lastSeen: "刚刚",
    residency: "药企侧 · 仅发起任务",
  },
];

export const tasks: RwsTask[] = [
  {
    id: "rws-2041",
    workloadType: "rws",
    title: "注射用紫杉醇 上市后不良反应信号检测",
    initiator: "恒瑞医药",
    purpose: "药物警戒 / 上市后安全性监测",
    cohort: "2024-01 至 2025-12 使用紫杉醇且年龄 ≥18 的住院患者",
    analysis: "按器官系统分类统计不良事件发生率,检出报告比失衡(PRR/ROR)红旗信号",
    status: "running",
    createdAt: "2026-06-13 09:12",
    targets: [
      { connectorId: "cn-huashan", org: "华山医院", state: "executing", progress: 64 },
      { connectorId: "cn-ruijin", org: "瑞金医院", state: "gate", progress: 92, note: "输出闸门:抑制 7 个小单元格" },
      { connectorId: "cn-zhongshan", org: "中山医院", state: "authorized", progress: 12 },
    ],
    policy: {
      purpose: "药物警戒",
      retention: "阅后即焚",
      output: "仅聚合 / 红旗信号",
      validUntil: "2026-09-13",
    },
  },
  {
    id: "rws-2038",
    workloadType: "rws",
    title: "某 PD-1 单抗 真实世界疗效队列分析",
    initiator: "恒瑞医药",
    purpose: "真实世界研究 / 疗效评估",
    cohort: "2023-2025 接受 PD-1 治疗的非小细胞肺癌患者",
    analysis: "总生存期与无进展生存期的 Kaplan-Meier 聚合估计",
    status: "completed",
    createdAt: "2026-06-10 14:30",
    targets: [
      { connectorId: "cn-huashan", org: "华山医院", state: "returned", progress: 100 },
      { connectorId: "cn-ruijin", org: "瑞金医院", state: "returned", progress: 100 },
    ],
    output: {
      kind: "聚合生存曲线 + 队列计数",
      rowsSuppressed: 4,
      summary: "合并队列 n=2,184;中位 PFS 9.8 月,经小单元格抑制后放行",
    },
    policy: {
      purpose: "真实世界研究",
      retention: "结果留存 90 天",
      output: "仅聚合",
      validUntil: "2026-08-10",
    },
  },
  {
    id: "rws-2052",
    workloadType: "rws",
    title: "口服降糖药 肝功能异常关联性探查",
    initiator: "恒瑞医药",
    purpose: "药物警戒 / 信号探查",
    cohort: "2024 起服用该药且有肝功能检验记录的患者",
    analysis: "ALT/AST 异常率分层统计",
    status: "awaiting-auth",
    createdAt: "2026-06-13 10:48",
    targets: [
      { connectorId: "cn-huashan", org: "华山医院", state: "pending", progress: 0, note: "等待数据提供方授权" },
      { connectorId: "cn-zhongshan", org: "中山医院", state: "pending", progress: 0, note: "等待数据提供方授权" },
    ],
    policy: {
      purpose: "药物警戒",
      retention: "阅后即焚",
      output: "仅聚合",
      validUntil: "2026-09-13",
    },
  },
  {
    id: "rws-2055",
    workloadType: "rws",
    title: "试图导出行级诊疗明细(被拦截)",
    initiator: "恒瑞医药",
    purpose: "未声明用途",
    cohort: "全部患者",
    analysis: "导出原始处方与诊断明细",
    status: "blocked",
    createdAt: "2026-06-13 11:02",
    targets: [
      { connectorId: "cn-ruijin", org: "瑞金医院", state: "denied", progress: 0, note: "输出闸门:含行级可识别数据,拒绝放行" },
    ],
    policy: {
      purpose: "—",
      retention: "—",
      output: "—",
      validUntil: "—",
    },
  },
];

export const attestations: Attestation[] = [
  {
    id: "att-9921",
    txHash: "0x8f3a…c41d",
    taskId: "rws-2038",
    taskTitle: "PD-1 单抗 真实世界疗效队列分析",
    kind: "output",
    participants: ["华山医院", "瑞金医院", "恒瑞医药"],
    inputFingerprint: "SM3:b7e2…90af",
    outputHash: "SM3:1c44…d8e0",
    block: 1_840_221,
    at: "2026-06-10 16:02",
  },
  {
    id: "att-9918",
    txHash: "0x2b71…9ae0",
    taskId: "rws-2038",
    taskTitle: "PD-1 单抗 真实世界疗效队列分析",
    kind: "policy",
    participants: ["瑞金医院", "恒瑞医药"],
    inputFingerprint: "—",
    outputHash: "SM3:policy:77c9…",
    block: 1_840_180,
    at: "2026-06-10 14:31",
  },
  {
    id: "att-9930",
    txHash: "0x55cd…1f2a",
    taskId: "rws-2055",
    taskTitle: "行级导出尝试(被拦截)",
    kind: "task",
    participants: ["瑞金医院", "恒瑞医药"],
    inputFingerprint: "SM3:fa01…77bd",
    outputHash: "拒绝放行 · 无输出",
    block: 1_840_402,
    at: "2026-06-13 11:02",
  },
];

export const spaceStats = {
  participants: connectors.length,
  online: connectors.filter((c) => c.status === "online").length,
  records: connectors.reduce((n, c) => n + c.recordCount, 0),
  activeTasks: tasks.filter((t) => t.status === "running" || t.status === "awaiting-auth").length,
  attestations: attestations.length,
  rawDataEgress: 0, // the whole point: zero raw rows ever leave
};

export const statusLabel: Record<TaskStatus, string> = {
  draft: "草稿",
  "awaiting-auth": "待授权",
  running: "执行中",
  completed: "已完成",
  blocked: "已拦截",
};

export const nodeStateLabel: Record<TaskNodeRun["state"], string> = {
  pending: "待授权",
  authorized: "已授权",
  executing: "TEE 执行中",
  gate: "输出闸门",
  returned: "已回传聚合",
  denied: "已拒绝",
};
