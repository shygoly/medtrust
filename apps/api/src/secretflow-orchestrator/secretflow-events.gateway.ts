import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { OrchestratorLogEvent } from './types';

/**
 * Browser-facing WebSocket fan-out for SecretFlow training logs.
 *
 * The orchestrator's {@link AgentLogBridge} subscribes to each Local Data
 * Agent's WS log stream and calls {@link broadcast}; this gateway forwards
 * normalized events to dashboard clients. Clients connect to
 * `ws://<api>/ws/secretflow?taskId=<id>` to filter to one task.
 *
 * Raw `ws` protocol (not socket.io) so a plain browser `new WebSocket()` works.
 */
@WebSocketGateway({ path: '/ws/secretflow' })
export class SecretFlowEventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SecretFlowEventsGateway.name);
  private readonly subscribers = new Map<WebSocket, string | null>();

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    let taskId: string | null = null;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      taskId = url.searchParams.get('taskId');
    } catch {
      taskId = null;
    }
    this.subscribers.set(client, taskId);
    this.send(client, { taskId: taskId ?? '', phase: 'connected' });
    client.on('message', (data) => this.onClientMessage(client, data.toString()));
  }

  handleDisconnect(client: WebSocket): void {
    this.subscribers.delete(client);
  }

  /** Allow a client to (re)bind its taskId filter after connecting. */
  private onClientMessage(client: WebSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg && msg.action === 'subscribe' && typeof msg.taskId === 'string') {
        this.subscribers.set(client, msg.taskId);
      }
    } catch {
      // ignore non-JSON pings
    }
  }

  broadcast(event: OrchestratorLogEvent): void {
    for (const [client, taskId] of this.subscribers) {
      if (taskId && taskId !== event.taskId) {
        continue;
      }
      this.send(client, event);
    }
  }

  private send(client: WebSocket, event: OrchestratorLogEvent): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }
}
