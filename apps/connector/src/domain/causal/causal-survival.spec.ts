import { InternalRecord } from '../types';

const DRUG = 'insulin';
const COMPARATOR = 'metformin';
const OUTCOME = 'ALT升高';
const ae = (term: string) => [{ organSystem: '肝胆系统', term, serious: false }];

function rec(over: Partial<InternalRecord>): InternalRecord {
  return {
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    sex: 'F',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [],
    followUpDays: 30,
    ...over,
  };
}

describe('定点 Cox 出域（任务 3.3）', () => {
  it('log HR 等于定点参考，尾箱不交出真实在险人数', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { causalSurvivalStageSandbox, columnsForCausalSurvival } = await import('@medtrust/domain-med');
    const { SURVIVAL_EFFECT_Q, decodeSurvivalEffect, survivalEffectQ16 } = await import(
      '@medtrust/wasm-algorithms'
    );

    const cohort: InternalRecord[] = [];
    for (let i = 0; i < 6; i++)
      cohort.push(rec({ medications: [DRUG], adverseEvents: ae(OUTCOME), followUpDays: 10 }));
    for (let i = 0; i < 6; i++)
      cohort.push(rec({ medications: [COMPARATOR], adverseEvents: ae(OUTCOME), followUpDays: 10 }));
    cohort.push(rec({ medications: [DRUG], followUpDays: 30 }));
    cohort.push(rec({ medications: [COMPARATOR], followUpDays: 30 }));
    cohort.push(rec({ medications: ['其他药'], followUpDays: 10, adverseEvents: ae(OUTCOME) }));

    const columns = columnsForCausalSurvival(cohort, DRUG, COMPARATOR, OUTCOME, 'adverse_event');
    expect(columns.treated).toHaveLength(14);
    const fitted = survivalEffectQ16({
      minCell: 5,
      binWidth: 30,
      treated: columns.treated,
      event: columns.event,
      duration: columns.duration,
    });

    const wasmPath = join(__dirname, '../../../../../packages/wasm-algorithms/build/causal-survival.wasm');
    const bytes = readFileSync(wasmPath);
    const memory = new WebAssembly.Memory({ initial: 2, maximum: 1024 });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
    const payload = await causalSurvivalStageSandbox.runStage({
      spaceId: 'sh-med',
      stageInput: {
        stage: {
          params: {
            drug: DRUG,
            comparator: COMPARATOR,
            outcome: OUTCOME,
            binWidthDays: 30,
            minCell: 5,
          },
          output_schema: 'rws.causal-survival/1.0',
        },
      },
      moduleSm3: 'test',
      rowsByRole: () => new Map(),
      codeWhitelist: () => undefined,
      tables: () => [{ node: 'a', rows: cohort }],
      strataKeys: () => undefined,
      configuredStrataKeys: () => undefined,
      runSandbox: async (request) => {
        expect(request.abi).toBe('survival-effect@1');
        new Uint8Array(memory.buffer).set(request.input, 0);
        const code = (
          instance.exports as { run: (a: number, b: number, c: number, d: number) => number }
        ).run(0, request.n ?? 0, request.k ?? 0, request.outOff);
        expect(code).toBe(0);
        const output = new Uint8Array(memory.buffer, request.outOff, request.outBytes).slice();
        expect(decodeSurvivalEffect(output)).toEqual(fitted);
        return { output };
      },
    });
    const body = (
      payload as {
        payload: {
          cohortSize: number;
          suppressed: boolean;
          effectEstimate: { beta: number; standardError: number; measure: string };
          kmCurve: { bins: Array<{ t: number; atRisk: number; suppressed?: boolean }> };
        };
      }
    ).payload;
    expect(body.cohortSize).toBe(14);
    expect(body.suppressed).toBe(false);
    expect(body.effectEstimate.measure).toBe('log_hr');
    expect(body.effectEstimate.beta).toBe(fitted.logHrQ / SURVIVAL_EFFECT_Q);
    const tail = body.kmCurve.bins.find((bin) => bin.t === 30);
    expect(tail?.suppressed).toBe(true);
    expect(tail?.atRisk).toBe(0);
    expect(JSON.stringify(body)).not.toContain('subjectKey');
  });
});
