import { Injectable } from '@nestjs/common';
import { RwsAnalysis } from './types';

export interface DispatchedTask {
  taskId: string;
  analysis: RwsAnalysis;
  purpose: string;
}

// Connector pulls work from the central control plane over an OUTBOUND call
// (data-space-connector spec 3.3). The connector never opens an inbound port;
// it reaches out to the control plane, which dispatches authorized tasks.
// `TaskFetcher` is injected so the transport (HTTPS/gRPC, SM2-secured) can vary
// and be mocked in tests/demo without a running control plane.
export type TaskFetcher = () => Promise<DispatchedTask[]>;

@Injectable()
export class TaskPuller {
  async pullOnce(fetch: TaskFetcher): Promise<DispatchedTask[]> {
    // Outbound request to the control plane. No server is listening on the
    // connector side for this — the connector is the client.
    return fetch();
  }
}
