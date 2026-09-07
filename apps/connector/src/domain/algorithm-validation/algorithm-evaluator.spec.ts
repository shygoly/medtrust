import { evaluateAlgorithm } from './algorithm-evaluator';
import { IdentificationAlgorithm, InternalRecord } from '../types';
import { validateAlgorithmGrammar } from './grammar-validator';

// Build minimal records. The evaluator touches conditions / medications /
// adverseEvents.term / followUpDays.
function rec(
  subjectKey: string,
  conditions: string[],
  medications: string[] = [],
  followUpDays?: number,
  adverseEvents: InternalRecord['adverseEvents'] = [],
): InternalRecord {
  return {
    subjectKey,
    ageBand: '40-49',
    conditions,
    medications,
    adverseEvents,
    followUpDays,
  };
}

const codeset = (codes: string[], valueSource: 'discharge_dx' | 'medication' = 'discharge_dx', diagnosisOrder: 'primary_only' | 'top3_discharge' | 'any' = 'any') => ({
  kind: 'codeset' as const,
  codeset: {
    codeSystem: 'ICD-10',
    codeSystemVersion: '2023',
    codes,
    valueSource,
    diagnosisOrder,
  },
});

describe('algorithm-evaluator — §2.7.4 four-element matching (task 2.3)', () => {
  it('matches on the medication value source', () => {
    const algo: IdentificationAlgorithm = {
      id: 'metformin-use',
      version: '1',
      expression: codeset(['metformin'], 'medication'),
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', ['E11.9'], ['metformin']),
      rec('s2', ['E11.9'], ['insulin']),
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
  });

  it('diagnosisOrder=primary_only matches only the first condition', () => {
    const algo: IdentificationAlgorithm = {
      id: 'dm2-primary',
      version: '1',
      expression: codeset(['E11.9'], 'discharge_dx', 'primary_only'),
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', ['E11.9', 'I10']), // E11.9 is primary
      rec('s2', ['I10', 'E11.9']), // E11.9 is secondary
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
  });

  it('diagnosisOrder=top3_discharge matches within the first three', () => {
    const algo: IdentificationAlgorithm = {
      id: 'dm2-top3',
      version: '1',
      expression: codeset(['E11.9'], 'discharge_dx', 'top3_discharge'),
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', ['A', 'B', 'E11.9']), // 3rd — in top 3
      rec('s2', ['A', 'B', 'C', 'E11.9']), // 4th — outside top 3
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
  });

  it('honors AND / OR / NOT boolean composition', () => {
    const algo: IdentificationAlgorithm = {
      id: 'dm2-and-not-insulin',
      version: '1',
      expression: {
        kind: 'and',
        children: [
          codeset(['E11.9']),
          { kind: 'not', child: codeset(['insulin'], 'medication') },
        ],
      },
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', ['E11.9'], ['metformin']), // dm2, not insulin → match
      rec('s2', ['E11.9'], ['insulin']), // dm2 + insulin → no match
      rec('s3', ['I10'], ['metformin']), // not dm2 → no match
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
    expect(out.get('s3')).toBe(false);
  });

  it('window node filters out subjects whose followUpDays is shorter than the window', () => {
    const algo: IdentificationAlgorithm = {
      id: 'windowed',
      version: '1',
      expression: {
        kind: 'window',
        days: 90,
        child: codeset(['E11.9']),
      },
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', ['E11.9'], [], 120), // followup long enough
      rec('s2', ['E11.9'], [], 30), // followup too short → false
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
  });

  it('emits a judgment for every input subject', () => {
    const algo: IdentificationAlgorithm = {
      id: 'all',
      version: '1',
      expression: codeset(['*']),
    };
    validateAlgorithmGrammar(algo);
    const records = [rec('s1', ['x']), rec('s2', []), rec('s3', ['y'])];
    const out = evaluateAlgorithm(algo, records);
    expect(out.size).toBe(3);
    expect(out.has('s1')).toBe(true);
    expect(out.has('s2')).toBe(true);
    expect(out.has('s3')).toBe(true);
  });

  it('matches pancreatitis screening codes against adverseEvents.term', () => {
    const algo: IdentificationAlgorithm = {
      id: 'panc-ae-term-v1',
      version: '1.0.0',
      expression: codeset(['acute pancreatitis'], 'discharge_dx'),
    };
    validateAlgorithmGrammar(algo);
    const records = [
      rec('s1', [], [], undefined, [
        { organSystem: '消化系统', term: 'acute pancreatitis', serious: true },
      ]),
      rec('s2', ['E11.9'], [], undefined, [
        { organSystem: '消化系统', term: 'nausea', serious: false },
      ]),
      rec('s3', ['acute pancreatitis']), // also match via conditions
    ];
    const out = evaluateAlgorithm(algo, records);
    expect(out.get('s1')).toBe(true);
    expect(out.get('s2')).toBe(false);
    expect(out.get('s3')).toBe(true);
  });
});
