import { MdopError } from "../errors";

/**
 * 作业与阶段状态机（协议 §8.1 / §8.2 / 规格「作业与阶段状态机」）。
 *
 * 迁移 MUST 以**显式的合法迁移表**实现，非法迁移 MUST 被拒绝并记录审计。
 */

export const JOB_STATES = [
  "SUBMITTED",
  "COMPILED",
  "NEGOTIATING",
  "TICKETED",
  "RUNNING",
  "RELEASING",
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "REJECTED",
  "PURGED",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** 合法迁移表。`REJECTED` 与 `PURGED` 是终态（协议 §8.1）。 */
export const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  SUBMITTED: ["COMPILED", "REJECTED"],
  COMPILED: ["NEGOTIATING", "REJECTED"],
  NEGOTIATING: ["TICKETED", "REJECTED"],
  TICKETED: ["RUNNING", "ABORTED"],
  RUNNING: ["RELEASING", "FAILED", "ABORTED"],
  RELEASING: ["SUCCEEDED", "FAILED", "ABORTED"],
  SUCCEEDED: ["PURGED"],
  FAILED: ["PURGED"],
  ABORTED: ["PURGED"],
  REJECTED: [],
  PURGED: [],
};

export const JOB_TERMINAL_STATES: readonly JobState[] = [
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "REJECTED",
  "PURGED",
];

/** 需要触发销毁编排的终态（`REJECTED` 不作废制品：它发生在任何片段执行之前）。 */
export const JOB_PURGE_TRIGGER_STATES: readonly JobState[] = ["SUCCEEDED", "FAILED", "ABORTED"];

export const STAGE_STATES = [
  "PENDING",
  "READY",
  "RUNNING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type StageState = (typeof STAGE_STATES)[number];

/**
 * 阶段迁移表。本期没有控制类算子，不使用 `SKIPPED`
 * （协议 §8.2 有 `READY → SKIPPED`，实现里保留注释说明而非空转分支）。
 */
export const STAGE_TRANSITIONS: Readonly<Record<StageState, readonly StageState[]>> = {
  PENDING: ["READY"],
  READY: ["RUNNING"],
  RUNNING: ["SUCCEEDED", "RETRYING", "FAILED"],
  RETRYING: ["RUNNING", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
};

export const STAGE_RETRY_LIMIT = 3;

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function canTransitionStage(from: StageState, to: StageState): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

/** 非法迁移：拒绝并让调用方记审计。 */
export function assertJobTransition(from: JobState, to: JobState): void {
  if (!canTransitionJob(from, to))
    throw new MdopError("E_RUNTIME", {}, `非法作业状态迁移 ${from} → ${to}`);
}

export function assertStageTransition(from: StageState, to: StageState): void {
  if (!canTransitionStage(from, to))
    throw new MdopError("E_RUNTIME", {}, `非法阶段状态迁移 ${from} → ${to}`);
}

/** 指数退避（秒）：30、60、120（D12「本地算子最多重试 3 次」）。 */
export function retryBackoffSeconds(attempt: number): number {
  return 30 * 2 ** Math.max(0, attempt - 1);
}

export function idempotencyKey(jobId: string, stage: string, attempt: number): string {
  return `${jobId}:${stage}:${attempt}`;
}
