import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { OrchestratorFsmService } from './orchestrator-fsm.service';
import { SecretFlowEventsGateway } from './secretflow-events.gateway';
import { OrchestrationRecord, OrchestratorLogEvent } from './types';

export type OnCompleteFn = (record: OrchestrationRecord) => void;

const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.SF_STATUS_TIMEOUT_MS || 20000);

/**
 * Bridges a Local Data Agent's WebSocket training-log stream into the control
 * plane: normalizes each event, folds it into the FSM, and fans it out to
 * dashboard clients via {@link SecretFlowEventsGateway}.
 *
 * Implements the §5.1 watchdog: if the stream goes idle while TRAINING, the
 * last-active participant is compensated (dropped) so the job does not hang.
 */
@Injectable()
export class AgentLogBridge {
  private readonly logger = new Logger(AgentLogBridge.name);
  private readonly sockets = new Map<string, WebSocket>();

  constructor(
    private readonly fsm: OrchestratorFsmService,
    private readonly gateway: SecretFlowEventsGateway,
  ) {}

  /** Connect to an agent's task stream and pump events until terminal. */
  connect(
    taskId: string,
    streamUrl: string,
    onComplete?: OnCompleteFn,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  ): void {
    if (this.sockets.has(taskId)) {
      return;
    }
    const ws = new WebSocket(streamUrl);
    this.sockets.set(taskId, ws);

    let lastParticipant: string | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const armWatchdog = () => {
      if (!idleTimeoutMs) {
        return;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => this.onStall(taskId, lastParticipant), idleTimeoutMs);
    };

    ws.on('open', armWatchdog);

    ws.on('message', (data) => {
      armWatchdog();
      const event = this.normalize(taskId, data.toString());
      if (!event) {
        return;
      }
      if (event.participantId) {
        lastParticipant = event.participantId;
      }
      const record = this.fsm.applyEvent(taskId, event);
      this.gateway.broadcast({ ...event, state: record?.state });

      // The 'result' frame lands after 'done' (COMPLETED) carrying the safe
      // envelope — the trigger for attestation + settlement.
      if (event.phase === 'result' && record && onComplete) {
        try {
          onComplete(record);
        } catch (err) {
          this.logger.warn(
            `settlement hook failed task=${taskId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    });

    const close = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      this.sockets.delete(taskId);
    };
    ws.on('close', close);
    ws.on('error', (err) => {
      this.logger.warn(`agent stream error task=${taskId}: ${err.message}`);
      this.gateway.broadcast({ taskId, phase: 'stream_error', reason: err.message });
      close();
    });
  }

  private onStall(taskId: string, participantId?: string): void {
    const record = this.fsm.get(taskId);
    if (!record || record.state !== 'TRAINING') {
      return;
    }
    const victim = participantId ?? record.nodePlan[0]?.participantId;
    if (!victim) {
      return;
    }
    this.logger.warn(`stream idle for task=${taskId}; compensating ${victim}`);
    this.fsm.compensate(taskId, victim, 'status_timeout');
    this.gateway.broadcast({
      taskId,
      phase: 'compensation',
      participantId: victim,
      reason: 'status_timeout',
      state: this.fsm.get(taskId)?.state,
    });
  }

  /** Map the agent's snake_case event payload to an OrchestratorLogEvent. */
  private normalize(taskId: string, raw: string): OrchestratorLogEvent | null {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const phase = String(parsed.phase ?? 'log');
    return {
      taskId,
      phase,
      participantId: (parsed.participant_id ?? parsed.participantId) as string | undefined,
      epoch: parsed.epoch as number | undefined,
      round: parsed.round as number | undefined,
      loss: parsed.loss as number | undefined,
      globalLoss: (parsed.global_loss ?? parsed.globalLoss) as number | undefined,
      elapsedSeconds: (parsed.elapsed_seconds ?? parsed.elapsedSeconds) as number | undefined,
      result: parsed.result,
      reason: parsed.reason,
    };
  }
}
