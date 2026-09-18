// Mock data for the 可信数据空间控制台 (federated data-space console).
// Stands in for the future connector / control-plane APIs so the UI is
// demonstrable before any backend exists. See openspec/changes/federated-data-space-rws.
// Canonical CKD scenario data lives in @medtrust/demo-scenario.

import {
  CONNECTORS,
  SPACE_TASKS,
  ATTESTATIONS,
  computeSpaceStats,
  type Connector,
  type SpaceTask,
  type Attestation,
  type TaskNodeRun,
  type TaskStatus,
  type WorkloadType,
  type UsagePolicy,
} from '@medtrust/demo-scenario';

export type { Connector, SpaceTask as RwsTask, Attestation, TaskNodeRun, TaskStatus, WorkloadType, UsagePolicy };
export type ConnectorRole = Connector['role'];
export type ConnectorStatus = Connector['status'];

export const connectors = CONNECTORS;
export const tasks = SPACE_TASKS;
export const attestations = ATTESTATIONS;
export const spaceStats = computeSpaceStats();

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
