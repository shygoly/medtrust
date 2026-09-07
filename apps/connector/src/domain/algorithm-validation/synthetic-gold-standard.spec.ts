import {
  synthesizeGoldStandard,
  goldFromInjectedTruth,
  resolveGoldStandard,
  shouldUseFlipGoldStandard,
  impliedSeSp,
} from './synthetic-gold-standard';

// rws-algorithm-validation §7.1–7.3 + D-DATA-1 Task 4:
describe('goldFromInjectedTruth — L0 gold from injection truth', () => {
  const truth = [
    { subjectKey: 'huashan-0', truePancreatitis: true },
    { subjectKey: 'huashan-1', truePancreatitis: false },
    { subjectKey: 'ruijin-0', truePancreatitis: true },
  ];

  it('maps truePancreatitis → positive/negative', () => {
    const gold = goldFromInjectedTruth(truth);
    expect(gold.get('huashan-0')).toBe('positive');
    expect(gold.get('huashan-1')).toBe('negative');
    expect(gold.get('ruijin-0')).toBe('positive');
  });

  it('filters by subjectKeys when provided', () => {
    const gold = goldFromInjectedTruth(truth, ['huashan-0', 'huashan-1']);
    expect(gold.size).toBe(2);
    expect(gold.has('ruijin-0')).toBe(false);
  });
});

describe('resolveGoldStandard — prefer injected truth', () => {
  const opts = {
    variableDefinitionId: 'panc',
    goldStandardSetVersion: 'inj-v1',
    algorithmId: 'panc-code',
    algorithmVersion: '1.0.0',
  };
  const preds = new Map<string, boolean>([
    ['huashan-0', true],
    ['huashan-1', false],
  ]);
  const truth = [
    { subjectKey: 'huashan-0', truePancreatitis: false }, // FN vs algo
    { subjectKey: 'huashan-1', truePancreatitis: false },
  ];

  it('uses injected truth by default', () => {
    const gold = resolveGoldStandard(preds, { ...opts, truth }, {});
    expect(gold.get('huashan-0')).toBe('negative'); // from truth, not flip
    expect(gold.get('huashan-1')).toBe('negative');
  });

  it('MEDTRUST_SYNTH_GOLD_FLIP=1 forces flip-based synth (rollback)', () => {
    expect(shouldUseFlipGoldStandard({ MEDTRUST_SYNTH_GOLD_FLIP: '1' })).toBe(true);
    const gold = resolveGoldStandard(
      preds,
      { ...opts, truth, flipOnPositive: 0, flipOnNegative: 0 },
      { MEDTRUST_SYNTH_GOLD_FLIP: '1' },
    );
    // flip rate 0 → gold equals predictions
    expect(gold.get('huashan-0')).toBe('positive');
    expect(gold.get('huashan-1')).toBe('negative');
  });

  it('falls back to flip synth when truth is empty', () => {
    const gold = resolveGoldStandard(
      preds,
      { ...opts, truth: [], flipOnPositive: 0, flipOnNegative: 0 },
      {},
    );
    expect(gold.get('huashan-0')).toBe('positive');
  });
});

describe('synthesizeGoldStandard — §7.1 legacy flip synth', () => {
  const opts = {
    variableDefinitionId: 'dm2',
    goldStandardSetVersion: 'syn-v1',
    algorithmId: 'dm2-dx',
    algorithmVersion: '1.0.0',
  };

  function buildPredictions(n: number, positiveFraction = 0.5): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (let i = 0; i < n; i++) {
      out.set(`s-${i}`, i / n < positiveFraction);
    }
    return out;
  }

  it('flip rate 0 → Se = Sp = 1 (gold equals algorithm output)', () => {
    const preds = buildPredictions(100);
    const gold = synthesizeGoldStandard(preds, { ...opts, flipOnPositive: 0, flipOnNegative: 0 });
    const { se, sp } = impliedSeSp(preds, gold);
    expect(se).toBe(1);
    expect(sp).toBe(1);
  });

  it('is deterministic across calls with the same inputs', () => {
    const preds = buildPredictions(200);
    const g1 = synthesizeGoldStandard(preds, opts);
    const g2 = synthesizeGoldStandard(preds, opts);
    expect([...g1.entries()]).toEqual([...g2.entries()]);
  });

  it('different algorithmVersion → different annotations (version binds)', () => {
    const preds = buildPredictions(200);
    const v1 = synthesizeGoldStandard(preds, { ...opts, algorithmVersion: '1.0.0' });
    const v2 = synthesizeGoldStandard(preds, { ...opts, algorithmVersion: '2.0.0' });
    // The two should differ on *some* subject (extremely unlikely otherwise).
    let diff = 0;
    for (const [k, v] of v1) if (v2.get(k) !== v) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it('salt produces a distinct set off the same triple', () => {
    const preds = buildPredictions(200);
    const a = synthesizeGoldStandard(preds, { ...opts, salt: 'A' });
    const b = synthesizeGoldStandard(preds, { ...opts, salt: 'B' });
    let diff = 0;
    for (const [k, v] of a) if (b.get(k) !== v) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it('expected Se/Sp converge to 1 − flipRate at large N', () => {
    // flip 0.2 on each class → Se ≈ Sp ≈ 0.8. With N=2000, tolerance 0.05.
    const preds = buildPredictions(2000, 0.5);
    const gold = synthesizeGoldStandard(preds, {
      ...opts,
      flipOnPositive: 0.2,
      flipOnNegative: 0.2,
      salt: 'convergence',
    });
    const { se, sp } = impliedSeSp(preds, gold);
    expect(se).toBeGreaterThan(0.75);
    expect(se).toBeLessThan(0.85);
    expect(sp).toBeGreaterThan(0.75);
    expect(sp).toBeLessThan(0.85);
  });

  it('independent flips across iterations (not correlated with subjectKey order)', () => {
    const preds1 = new Map([
      ['s-a', true],
      ['s-b', false],
      ['s-c', true],
    ]);
    const preds2 = new Map([
      ['s-c', true],
      ['s-a', true],
      ['s-b', false],
    ]);
    const g1 = synthesizeGoldStandard(preds1, opts);
    const g2 = synthesizeGoldStandard(preds2, opts);
    expect(g1.get('s-a')).toBe(g2.get('s-a'));
    expect(g1.get('s-b')).toBe(g2.get('s-b'));
    expect(g1.get('s-c')).toBe(g2.get('s-c'));
  });

  it('returns a judgment for every input subject', () => {
    const preds = buildPredictions(50);
    const gold = synthesizeGoldStandard(preds, opts);
    expect(gold.size).toBe(50);
    for (const k of preds.keys()) expect(gold.has(k)).toBe(true);
  });
});
