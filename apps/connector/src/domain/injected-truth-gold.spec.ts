import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEMO_GOLD_SET_VERSION,
  DEMO_GOLD_VARIABLE_DEFINITION_ID,
  goldRowsFromInjectedTruth,
  loadSyntheticGoldBeside,
  resolveSiblingTruthPath,
} from './injected-truth-gold';

describe('injected-truth-gold', () => {
  it('maps truePancreatitis → synthetic gold rows under demo variable id', () => {
    const rows = goldRowsFromInjectedTruth([
      { subjectKey: 'demohospa-1', truePancreatitis: true },
      { subjectKey: 'demohospa-2', truePancreatitis: false },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      subjectKey: 'demohospa-1',
      judgment: 'positive',
      source: 'synthetic',
      variableDefinitionId: DEMO_GOLD_VARIABLE_DEFINITION_ID,
      goldStandardSetVersion: DEMO_GOLD_SET_VERSION,
    });
    expect(rows[1].judgment).toBe('negative');
  });

  it('loads sibling truth.json beside a directory of records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-gold-'));
    fs.writeFileSync(
      path.join(dir, 'records.json'),
      JSON.stringify([{ subjectKey: 'demohospa-0', medications: [], adverseEvents: [], conditions: [] }]),
    );
    fs.writeFileSync(
      path.join(dir, 'truth.json'),
      JSON.stringify([
        { subjectKey: 'demohospa-0', truePancreatitis: true, site: 'demohospa' },
      ]),
    );

    expect(resolveSiblingTruthPath(dir)).toBe(path.join(dir, 'truth.json'));
    const rows = loadSyntheticGoldBeside(dir);
    expect(rows).not.toBeNull();
    expect(rows!).toHaveLength(1);
    expect(rows![0].source).toBe('synthetic');
    expect(rows![0].judgment).toBe('positive');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no truth sidecar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-nogold-'));
    fs.writeFileSync(path.join(dir, 'records.json'), '[]');
    expect(loadSyntheticGoldBeside(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
