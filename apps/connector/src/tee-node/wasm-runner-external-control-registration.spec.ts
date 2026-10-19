import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import {
  NODE_OPERATOR_FAILURE_MESSAGE,
  registerNodeWasmOps,
} from './wasm-runner';

const BUILD = join(__dirname, '../../../../packages/wasm-algorithms/build');
const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8')) as {
  modules: Array<{ analysisType: string; file: string; sm3: string }>;
};
const entry = manifest.modules.find(
  (module) => module.analysisType === 'external-control-registration',
)!;
const BYTES = new Uint8Array(readFileSync(join(BUILD, entry.file)));
const DIGEST = `sm3:${entry.sm3}`;
const TRIAL = 'urn:tds:sh-med:participant:p-trial';
const CONTROL = 'urn:tds:sh-med:participant:p-control';

function row(index: number, control: boolean) {
  return {
    subjectKey: `${control ? 'c' : 't'}-${index}`,
    linkKey: `lk-${control ? 'c' : 't'}-${index}`,
    sourceId: control ? 'external-primary' : 'sponsor-trial',
    age: 35 + ((index * 11) % 45),
    sex: index % 2 ? 'M' : 'F',
    calendarYear: 2021 + (index % 4),
    timeZero: '2022-01-15',
    eligibleAtTimeZero: true,
    treatmentStrategy: control ? 'historical-standard-care' : 'investigational-regimen',
    severity: 1 + (index % 5),
    diseaseDuration: index % 12,
    comorbidityIndex: index % 6,
    priorTreatment: index % 2,
    keyBiomarker: 1 + (index % 9),
    outcome: index % 7 === 0 ? 'neg' : 'pos',
    outcomeDate: index % 7 === 0 ? null : '2022-04-15',
    followUpDays: 365,
    censorDate: null,
    intercurrentEvents: [],
  };
}

const trialRows = Array.from({ length: 40 }, (_, i) => row(i, false));
const controlRows = Array.from({ length: 80 }, (_, i) => row(i + 500, true));

const MANIFEST = {
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id: 'rws.external-control-registration',
  version: '1.0.0',
  category: 'collab',
  digest: DIGEST,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: [
    { name: 'trial', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
    { name: 'controls', schema: 'mdop.projection/1.0', accept_labels: ['C2'] },
  ],
  outputs: [
    {
      name: 'registration',
      schema: 'rws.external-control-registration/1.0',
      label_rule: 'inherit',
    },
  ],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: {
    source_digest: `sm3:${'7'.repeat(64)}`,
    toolchain: 'asc@0.27.37',
    reproducible: true,
  },
};

function stage(over: Record<string, unknown> = {}) {
  return {
    id: 'registration',
    node: 'urn:tds:sh-med:participant:tee-node-a',
    op: 'rws.external-control-registration@1.0.0',
    op_digest: DIGEST,
    params: {
      parties: [
        { ref: 't', node: TRIAL },
        { ref: 'c', node: CONTROL },
      ],
      roles: { trial: TRIAL, controls: CONTROL },
      covariates: [
        'age',
        'severity',
        'diseaseDuration',
        'comorbidityIndex',
        'priorTreatment',
        'keyBiomarker',
        'calendarYear',
      ],
      effectMeasure: 'risk-ratio',
      missingness: 'MAR',
      synthetic: true,
      truthRr: 0.65,
      study: {
        profileVersion: 'registration-eca/1.0.0',
        timeZero: 'treatment-start',
        estimandSapVersion: 'sap-1',
      },
      ...over,
    },
    inputs: [
      { from: 't' },
      { from: 'c' },
    ],
    input_labels: ['C2', 'C2'] as const,
    output_label: 'C3' as const,
    output_schema: 'rws.external-control-registration/1.0',
  };
}

async function run(trial = trialRows, control = controlRows, over = {}) {
  const executor = new MdopStageExecutor();
  registerNodeWasmOps(executor, {
    moduleBytes: (digest) => (digest === entry.sm3 ? BYTES : undefined),
  });
  return executor.execute(
    {
      jobId: 'job-registration',
      stage: stage(over) as never,
      inputs: new Map([
        ['t', { rows: trial } as unknown as Record<string, unknown>],
        ['c', { rows: control } as unknown as Record<string, unknown>],
      ]),
      attempt: 1,
    },
    MANIFEST,
  );
}

describe('registration external-control node operator', () => {
  it('runs the real wasm kernel and returns aggregate-only diagnostics', async () => {
    const out = await run();
    const payload = out.payload as Record<string, unknown>;
    expect(out.label).toBe('C3');
    expect(payload.analysisType).toBe('external-control-registration');
    expect(payload.synthetic).toBe(true);
    expect(payload.estimand).toBe('ATT');
    expect(payload.estimator).toBe('IPTW-ATT');
    expect((payload.cohort as { analysisTrialN: number }).analysisTrialN).toBeGreaterThan(0);
    expect((payload.balance as unknown[]).length).toBe(7);
    expect((payload.overlap as { trimmed: number }).trimmed).toBeGreaterThanOrEqual(0);
    expect((payload.sensitivity as unknown[]).length).toBe(2);
    expect(payload.truthComparison).toBeDefined();
    expect(JSON.stringify(payload)).not.toContain('lk-t-');
  });

  it('rejects overlapping source partitions without exposing row values', async () => {
    const overlap = [...controlRows, { ...trialRows[0]! }];
    await expect(run(trialRows, overlap)).rejects.toThrow(NODE_OPERATOR_FAILURE_MESSAGE);
  });
});
