import { Injectable } from "@nestjs/common";
import { SecretFlowTaskSpec } from "../../compute-task/dto/secretflow-task-spec";
import {
  NodePlan,
  OrchestrationRecord,
  OrchestratorLogEvent,
  OrchestratorState,
} from "./types";

const LEGAL: Record<OrchestratorState, OrchestratorState[]> = {
  PENDING: ["VALIDATING", "FAILED"],
  VALIDATING: ["PLANNING", "FAILED"],
  PLANNING: ["DISPATCHING", "FAILED"],
  DISPATCHING: ["TRAINING", "FAILED"],
  TRAINING: ["AGGREGATING", "COMPENSATING", "COMPLETED", "FAILED"],
  AGGREGATING: ["TRAINING", "COMPLETED", "FAILED"],
  COMPENSATING: ["TRAINING", "COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

const TERMINAL: OrchestratorState[] = ["COMPLETED", "FAILED"];

/**
 * Distributed-transaction control for a SecretFlow orchestration (design §5.1).
 *
 * A finite state machine tracks each task's lifecycle. When a node's gradient /
 * status stream times out, {@link compensate} drops that node from the current
 * round (the aggregation center proceeds without it) rather than stalling the
 * whole job — the design's "Compensation Action".
 */
@Injectable()
export class OrchestratorFsmService {
  private readonly records = new Map<string, OrchestrationRecord>();

  create(
    taskId: string,
    spec: SecretFlowTaskSpec,
    nodePlan: NodePlan[],
    transpiledPayload: string,
  ): OrchestrationRecord {
    const record: OrchestrationRecord = {
      taskId,
      state: "PENDING",
      spec,
      nodePlan,
      transpiledPayload,
      history: [],
      droppedParties: [],
    };
    this.records.set(taskId, record);
    return record;
  }

  get(taskId: string): OrchestrationRecord | undefined {
    return this.records.get(taskId);
  }

  list(): OrchestrationRecord[] {
    return [...this.records.values()];
  }

  canTransition(from: OrchestratorState, to: OrchestratorState): boolean {
    return LEGAL[from].includes(to);
  }

  isTerminal(state: OrchestratorState): boolean {
    return TERMINAL.includes(state);
  }

  /** Explicit transition; throws on an illegal edge. */
  transition(
    taskId: string,
    to: OrchestratorState,
    reason?: string,
  ): OrchestrationRecord {
    const record = this.require(taskId);
    if (record.state === to) {
      return record;
    }
    if (!this.canTransition(record.state, to)) {
      throw new Error(
        `Illegal SecretFlow FSM transition ${record.state} -> ${to} for task ${taskId}`,
      );
    }
    record.history.push({
      from: record.state,
      to,
      at: new Date().toISOString(),
      reason,
    });
    record.state = to;
    return record;
  }

  /** Tolerant transition used while consuming the live event stream. */
  private safeTransition(
    record: OrchestrationRecord,
    to: OrchestratorState,
    reason?: string,
  ): void {
    if (record.state === to || this.isTerminal(record.state)) {
      return;
    }
    if (this.canTransition(record.state, to)) {
      record.history.push({
        from: record.state,
        to,
        at: new Date().toISOString(),
        reason,
      });
      record.state = to;
    }
  }

  /**
   * Compensation: drop a timed-out / failed node from the round and resume
   * training. The job continues with the surviving parties.
   */
  compensate(
    taskId: string,
    participantId: string,
    reason: string,
  ): OrchestrationRecord {
    const record = this.require(taskId);
    if (this.isTerminal(record.state)) {
      return record;
    }
    if (!record.droppedParties.includes(participantId)) {
      record.droppedParties.push(participantId);
    }
    this.safeTransition(
      record,
      "COMPENSATING",
      `drop ${participantId}: ${reason}`,
    );
    const survivors = record.nodePlan.filter(
      (n) => !record.droppedParties.includes(n.participantId),
    );
    if (survivors.length === 0) {
      this.safeTransition(record, "FAILED", "all parties dropped");
    } else {
      this.safeTransition(record, "TRAINING", "resume after compensation");
    }
    return record;
  }

  /** Fold a normalized agent log event into the FSM + metrics. */
  applyEvent(
    taskId: string,
    event: OrchestratorLogEvent,
  ): OrchestrationRecord | undefined {
    const record = this.records.get(taskId);
    if (!record) {
      return undefined;
    }
    switch (event.phase) {
      case "dispatched":
      case "preparing":
      case "baseline":
      case "training":
        this.safeTransition(record, "TRAINING", event.phase);
        break;
      case "round_complete":
        this.safeTransition(record, "AGGREGATING", "round aggregation");
        this.safeTransition(record, "TRAINING", "next round");
        break;
      case "compensation":
        if (event.participantId) {
          this.compensate(
            taskId,
            event.participantId,
            String(event.reason ?? "status_timeout"),
          );
        }
        break;
      case "done":
        this.safeTransition(record, "COMPLETED", "training complete");
        break;
      case "failed":
        this.safeTransition(
          record,
          "FAILED",
          String(event.reason ?? "agent reported failure"),
        );
        record.error = String(event.reason ?? "agent reported failure");
        break;
      case "result":
        record.result = event.result;
        break;
      default:
        break;
    }

    if (typeof event.loss === "number") {
      record.lastLoss = event.loss;
    } else if (typeof event.globalLoss === "number") {
      record.lastLoss = event.globalLoss;
    }
    if (typeof event.epoch === "number") {
      record.currentEpoch = event.epoch;
    } else if (typeof event.round === "number") {
      record.currentEpoch = event.round;
    }
    return record;
  }

  private require(taskId: string): OrchestrationRecord {
    const record = this.records.get(taskId);
    if (!record) {
      throw new Error(`No SecretFlow orchestration for task ${taskId}`);
    }
    return record;
  }
}
