import { InternalRecord } from '../types';

const DRUG = 'insulin';
const COMPARATOR = 'metformin';
const OUTCOME = 'acute pancreatitis';
const ae = (term: string) => [{ organSystem: '消化系统', term, serious: false }];

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    ...over,
  };
}

describe('定点 PSM 出域（任务 3.2）', () => {
  it('只交出 ATE 与标准误，并等于定点参考', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { causalPsmStageSandbox, columnsForCausalPsm } = await import('@medtrust/domain-med');
    const { CAUSAL_ATE_Q, causalAteQ16, decodeCausalAte } = await import('@medtrust/wasm-algorithms');

    const cohort: InternalRecord[] = [];
    for (let i = 0; i < 8; i++) cohort.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 4; i++) cohort.push(rec({ medications: [DRUG] }));
    for (let i = 0; i < 4; i++)
      cohort.push(rec({ medications: [COMPARATOR], adverseEvents: ae(OUTCOME) }));
    for (let i = 0; i < 12; i++) cohort.push(rec({ medications: [COMPARATOR] }));
    cohort.push(rec({ medications: ['其他药'], adverseEvents: ae(OUTCOME) }));

    const columns = columnsForCausalPsm(cohort, DRUG, COMPARATOR, OUTCOME, 'adverse_event', ['ageBand']);
    expect(columns.treated).toHaveLength(28);
    const fitted = causalAteQ16({
      method: 1,
      minCell: 1,
      treated: columns.treated,
      outcome: columns.outcome,
      stratum: columns.stratum,
      k: columns.k,
    });

    const wasmPath = join(__dirname, '../../../../../packages/wasm-algorithms/build/causal-psm.wasm');
    const bytes = readFileSync(wasmPath);
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1024 });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
    const payload = await causalPsmStageSandbox.runStage({
      spaceId: 'sh-med',
      stageInput: {
        stage: {
          params: {
            drug: DRUG,
            comparator: COMPARATOR,
            outcome: OUTCOME,
            method: 'psm',
            stratifyBy: ['ageBand'],
            minCell: 1,
          },
          output_schema: 'rws.causal-psm/1.0',
        },
      },
      moduleSm3: 'test',
      rowsByRole: () => new Map(),
      codeWhitelist: () => undefined,
      tables: () => [{ node: 'a', rows: cohort }],
      strataKeys: () => undefined,
      configuredStrataKeys: () => undefined,
      runSandbox: async (request) => {
        expect(request.abi).toBe('causal-ate@1');
        new Uint8Array(memory.buffer).set(request.input, 0);
        const code = (instance.exports as { run: (a: number, b: number, c: number, d: number) => number }).run(
          0,
          request.n ?? 0,
          request.k ?? 0,
          request.outOff,
        );
        expect(code).toBe(0);
        const output = new Uint8Array(memory.buffer, request.outOff, request.outBytes).slice();
        expect(decodeCausalAte(output)).toEqual(fitted);
        return { output };
      },
    });
    const body = (
      payload as {
        payload: {
          cohortSize: number;
          suppressed: boolean;
          buckets?: unknown;
          effectEstimate: { beta: number; standardError: number; measure: string };
        };
      }
    ).payload;
    expect(body.cohortSize).toBe(28);
    expect(body.suppressed).toBe(false);
    expect(body.buckets).toBeUndefined();
    expect(body.effectEstimate.measure).toBe('ate');
    expect(body.effectEstimate.beta).toBe(fitted.ateQ / CAUSAL_ATE_Q);
    expect(body.effectEstimate.standardError).toBe(fitted.seQ / CAUSAL_ATE_Q);
    expect(Math.abs(body.effectEstimate.beta - 4 / 12)).toBeLessThan(0.001);
    expect(JSON.stringify(body)).not.toContain('subjectKey');
  });
});
