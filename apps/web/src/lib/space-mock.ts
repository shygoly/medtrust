// 控制台共用的任务 / 节点状态词汇（类型 + 中文标签）。
//
// 本文件曾同时导出演示夹具（connectors / tasks / attestations / spaceStats），空间总览直接
// 渲染它们——那是演示数字，不是空间的真实状态。夹具导出已移除：总览与存证账本只读真实接口
// （见 lib/space-overview.ts、lib/attestations.ts）。此处只保留 UI 原语用到的类型与标签。

import type {
  Connector,
  SpaceTask,
  Attestation,
  TaskNodeRun,
  TaskStatus,
  WorkloadType,
  UsagePolicy,
} from '@medtrust/demo-scenario';

export type { Connector, SpaceTask as RwsTask, Attestation, TaskNodeRun, TaskStatus, WorkloadType, UsagePolicy };
export type ConnectorRole = Connector['role'];
export type ConnectorStatus = Connector['status'];

export const statusLabel: Record<TaskStatus, string> = {
  draft: '草稿',
  'awaiting-auth': '待授权',
  running: '执行中',
  completed: '已完成',
  blocked: '已拦截',
};

export const nodeStateLabel: Record<TaskNodeRun['state'], string> = {
  pending: '待授权',
  authorized: '已授权',
  executing: '院内执行中',
  gate: '输出闸门',
  returned: '已回传聚合',
  denied: '已拒绝',
};
