import {
  loadGoldStandard,
  loadGoldStandardAsync,
  NoGoldStandard,
  GoldStandardRow,
  GoldStandardStore,
  AsyncGoldStandardStore,
} from './gold-standard-loader';

const rows: GoldStandardRow[] = [
  { subjectKey: 's1', variableDefinitionId: 'dm2', judgment: 'positive', source: 'registry', goldStandardSetVersion: 'v1' },
  { subjectKey: 's2', variableDefinitionId: 'dm2', judgment: 'negative', source: 'study_review', goldStandardSetVersion: 'v1' },
  { subjectKey: 's3', variableDefinitionId: 'other', judgment: 'positive', source: 'registry', goldStandardSetVersion: 'v1' },
];

function inMemoryStore(rows: GoldStandardRow[]): GoldStandardStore {
  return {
    findByVariableDefinition(variableDefinitionId) {
      return rows.filter((r) => r.variableDefinitionId === variableDefinitionId);
    },
    provenanceFor(variableDefinitionId) {
      const subset = rows.filter((r) => r.variableDefinitionId === variableDefinitionId);
      return subset.some((r) => r.source === 'synthetic') ? 'synthetic' : 'real';
    },
  };
}

describe('gold-standard-loader (task 3.1)', () => {
  it('returns subjectKey → judgment for the target variable definition', () => {
    const out = loadGoldStandard(inMemoryStore(rows), 'dm2');
    expect(out.size).toBe(2);
    expect(out.get('s1')).toBe('positive');
    expect(out.get('s2')).toBe('negative');
  });

  it('MUST fail explicitly when no gold standard exists — never fall back to algorithm output', () => {
    // The critical scenario from the algorithm-validation spec.
    const empty: GoldStandardStore = {
      findByVariableDefinition: () => [],
      provenanceFor: () => 'real',
    };
    expect(() => loadGoldStandard(empty, 'nonexistent')).toThrow(NoGoldStandard);
  });

  it('last-write-wins on duplicate subjectKey within a set version', () => {
    const dup: GoldStandardRow[] = [
      { subjectKey: 's1', variableDefinitionId: 'dm2', judgment: 'positive', source: 'registry', goldStandardSetVersion: 'v1' },
      { subjectKey: 's1', variableDefinitionId: 'dm2', judgment: 'negative', source: 'study_review', goldStandardSetVersion: 'v1' },
    ];
    const out = loadGoldStandard(inMemoryStore(dup), 'dm2');
    expect(out.size).toBe(1);
    expect(out.get('s1')).toBe('negative');
  });

  it('async variant mirrors sync semantics', async () => {
    const asyncStore: AsyncGoldStandardStore = {
      async findByVariableDefinition(id) {
        return rows.filter((r) => r.variableDefinitionId === id);
      },
    };
    const out = await loadGoldStandardAsync(asyncStore, 'dm2');
    expect(out.size).toBe(2);
    const empty: AsyncGoldStandardStore = { findByVariableDefinition: async () => [] };
    await expect(loadGoldStandardAsync(empty, 'x')).rejects.toBeInstanceOf(NoGoldStandard);
  });
});
