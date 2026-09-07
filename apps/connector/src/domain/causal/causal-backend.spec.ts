import { createProductionCausalBackend } from './causal-backend';

describe('createProductionCausalBackend', () => {
  const prev = process.env.AGENT_GRPC_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.AGENT_GRPC_URL;
    else process.env.AGENT_GRPC_URL = prev;
  });

  it('fail-closed when AGENT_GRPC_URL is unset — never Echo', async () => {
    delete process.env.AGENT_GRPC_URL;
    const backend = createProductionCausalBackend();
    await expect(
      backend.runLocalCausal({
        taskId: 't',
        method: 'cox',
        specJson: '{}',
        cohortJson: '[]',
      }),
    ).rejects.toThrow(/AGENT_GRPC_URL/);
  });
});
