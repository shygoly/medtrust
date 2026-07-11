import { FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { assertSafeFlPartyRunResult } from './fl-output-guard';
import { finalizePartyResultWithDp } from './fl-dp-gate';
import { FlPartyRunResult } from './fl-run-result';
import {
  FlEnvironmentStatus,
  FlPreparedTask,
  FlRuntimeAdapter,
  FlRuntimeContext,
} from './fl-runtime-adapter';
import { hashFlPredictionSpec, MockFlAdapter } from './mock-fl-adapter';

export interface HttpFlAdapterOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpFlAdapter implements FlRuntimeAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly fallback = new MockFlAdapter();

  constructor(options: HttpFlAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  validateEnvironment(): FlEnvironmentStatus {
    return {
      ready: true,
      runtime: 'connector-ml',
      details: this.baseUrl,
    };
  }

  async validateEnvironmentAsync(): Promise<FlEnvironmentStatus> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/fl/environment`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return {
          ready: false,
          runtime: 'connector-ml',
          details: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as FlEnvironmentStatus;
      return {
        ready: Boolean(body.ready),
        runtime: 'connector-ml',
        details: body.details ?? this.baseUrl,
      };
    } catch (err) {
      return {
        ready: false,
        runtime: 'connector-ml',
        details: (err as Error).message,
      };
    }
  }

  prepare(context: FlRuntimeContext): FlPreparedTask {
    return this.fallback.prepare(context);
  }

  async run(
    prepared: FlPreparedTask,
    spec: FlPredictionTaskSpec,
    context?: FlRuntimeContext,
  ): Promise<FlPartyRunResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/fl/train`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prepared,
        spec,
        tabularRows: context?.tabularRows ?? [],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`connector-ml train failed: HTTP ${res.status} ${text}`);
    }

    const body = (await res.json()) as FlPartyRunResult;
    const expectedHash = hashFlPredictionSpec(prepared.taskId, spec);
    if (!body.localModelHash) {
      body.localModelHash = `LOCAL:${expectedHash.slice(-16)}`;
    }
    const safe = assertSafeFlPartyRunResult(body);
    return finalizePartyResultWithDp(spec, safe);
  }

  cleanup(_prepared: FlPreparedTask): void {
    // HTTP sidecar is stateless per request.
  }
}

export function createFlRuntimeAdapter(): FlRuntimeAdapter {
  const url = process.env.CONNECTOR_ML_URL?.trim();
  if (url) {
    return new HttpFlAdapter({ baseUrl: url });
  }
  return new MockFlAdapter();
}
