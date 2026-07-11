import { CausalAgentClient } from './causal-agent-client';

describe('CausalAgentClient', () => {
  it('parses OK agent envelope', async () => {
    const client = new CausalAgentClient(async () => ({
      ackStatus: 'OK',
      resultJson: JSON.stringify({
        analysisType: 'causal-psm',
        cohortSize: 10,
        buckets: [],
        effectEstimate: {
          measure: 'ate',
          beta: 0.12,
          standardError: 0.04,
          ci95: [0.04, 0.2],
        },
      }),
    }));

    const out = await client.runLocalCausal({
      taskId: 't1',
      method: 'psm',
      specJson: '{}',
      cohortJson: '[]',
    });
    expect(out.analysisType).toBe('causal-psm');
    expect(out.effectEstimate?.measure).toBe('ate');
  });

  it('rejects row-level agent payload', async () => {
    const client = new CausalAgentClient(async () => ({
      ackStatus: 'OK',
      resultJson: JSON.stringify({ subjectKey: 'x', analysisType: 'bad', buckets: [] }),
    }));
    await expect(
      client.runLocalCausal({
        taskId: 't1',
        method: 'psm',
        specJson: '{}',
        cohortJson: '[]',
      }),
    ).rejects.toThrow(/行级/);
  });
});
