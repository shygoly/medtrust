import { of } from 'rxjs';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('does not mark optional services unhealthy when their URLs are not configured', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          CHAIN_SIDECAR_URL: 'https://chain.example',
          MP_SPDZ_GATEWAY_URL: 'https://mpc.example',
        };
        return values[key] ?? fallback;
      }),
    };
    const http = { get: jest.fn(() => of({ status: 200 })) };

    const health = await new HealthService(config as any, http as any).checkAllServices();

    expect(health.status).toBe('healthy');
    expect(health.services.find((s) => s.service === 'fate-flow')?.status).toBe('unknown');
    expect(health.services.find((s) => s.service === 'fhir')?.status).toBe('unknown');
  });
});
