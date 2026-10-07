// 任务状态与节点状态的词汇和标签（DESIGN §2 状态映射表的代码侧），供 TaskStatusBadge / NodeStateBadge 使用。

export type TaskStatus = "draft" | "awaiting-auth" | "running" | "completed" | "blocked";
export type NodeRunState = "pending" | "authorized" | "executing" | "gate" | "returned" | "denied";

export const statusLabel: Record<TaskStatus, string> = {
  draft: "草稿",
  "awaiting-auth": "待授权",
  running: "执行中",
  completed: "已完成",
  blocked: "已拦截",
};

export const nodeStateLabel: Record<NodeRunState, string> = {
  pending: "待授权",
  authorized: "已授权",
  executing: "院内执行中",
  gate: "输出闸门",
  returned: "已回传聚合",
  denied: "已拒绝",
};
