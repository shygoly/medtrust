import { MdopError } from "../errors";

/**
 * 聚合阶段状态机（协议 v0.3 §7.6.2）。
 * 缺任一参与方即 REJECTED，不得把已收到的贡献当成部分结果。
 */

export const AGGREGATE_PHASES = [
  "PENDING",
  "AGGREGATING",
  "AGGREGATED",
  "SUCCEEDED",
  "REJECTED",
] as const;
export type AggregatePhase = (typeof AGGREGATE_PHASES)[number];

export interface AggregateMachineState {
  phase: AggregatePhase;
  parties: readonly string[];
  received: readonly string[];
  finished: readonly string[];
  deadlineMs: number;
}

export function startAggregating(
  state: AggregateMachineState,
  nowMs: number,
): AggregateMachineState {
  assertPhase(state, "PENDING");
  if (state.parties.length < 2)
    throw new MdopError("E_LABEL_VIOLATION", {}, "安全聚合至少需要两个参与方");
  return {
    ...state,
    phase: "AGGREGATING",
    received: [],
    finished: [],
    deadlineMs: state.deadlineMs > nowMs ? state.deadlineMs : nowMs,
  };
}

/** 记录一份贡献。收齐才进入 AGGREGATED；超时或未知参与方进入 REJECTED，不保留部分合并。 */
export function acceptContribution(
  state: AggregateMachineState,
  party: string,
  nowMs: number,
): AggregateMachineState {
  if (state.phase === "REJECTED" || state.phase === "SUCCEEDED") return state;
  if (state.phase !== "AGGREGATING")
    throw new MdopError("E_RUNTIME", {}, `聚合阶段状态 ${state.phase} 不接受贡献`);
  if (nowMs > state.deadlineMs) return reject(state);
  if (!state.parties.includes(party)) return reject(state);
  if (state.received.includes(party)) return state;
  const received = [...state.received, party];
  const complete = state.parties.every((id) => received.includes(id));
  return {
    ...state,
    received,
    phase: complete ? "AGGREGATED" : "AGGREGATING",
  };
}

/** 超时仍缺贡献 → REJECTED。已收齐的不再被超时打回。 */
export function expireAggregate(
  state: AggregateMachineState,
  nowMs: number,
): AggregateMachineState {
  if (state.phase !== "AGGREGATING") return state;
  if (nowMs <= state.deadlineMs) return state;
  if (state.parties.every((id) => state.received.includes(id))) return state;
  return reject(state);
}

/** 某参与方完成本地聚合。全部完成才 SUCCEEDED。 */
export function noteAggregateFinished(
  state: AggregateMachineState,
  party: string,
): AggregateMachineState {
  if (state.phase === "REJECTED") return state;
  if (state.phase !== "AGGREGATED")
    throw new MdopError("E_RUNTIME", {}, "贡献未收齐，不能交付聚合结果");
  if (!state.parties.includes(party)) return reject(state);
  if (state.finished.includes(party)) return state;
  const finished = [...state.finished, party];
  const complete = state.parties.every((id) => finished.includes(id));
  return { ...state, finished, phase: complete ? "SUCCEEDED" : "AGGREGATED" };
}

/** 解密失败或节点拒绝：整个聚合 REJECTED，不跳过该份贡献。 */
export function rejectAggregate(state: AggregateMachineState): AggregateMachineState {
  if (state.phase === "SUCCEEDED")
    throw new MdopError("E_RUNTIME", {}, "已完成的聚合不能再拒绝");
  return reject(state);
}

function reject(state: AggregateMachineState): AggregateMachineState {
  return { ...state, phase: "REJECTED" };
}

function assertPhase(state: AggregateMachineState, phase: AggregatePhase): void {
  if (state.phase !== phase)
    throw new MdopError("E_RUNTIME", {}, `聚合阶段必须处于 ${phase}，当前 ${state.phase}`);
}
