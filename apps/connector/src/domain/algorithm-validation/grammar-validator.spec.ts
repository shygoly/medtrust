import {
  validateAlgorithmGrammar,
  validateAlgorithmExpression,
  validateCodeSet,
  InvalidAlgorithmGrammar,
  IncompleteCodeSet,
} from './grammar-validator';
import { AlgorithmExpression, CodeSet, IdentificationAlgorithm } from '../types';

// Helper: a minimal legal code set.
const goodCodeset: CodeSet = {
  codeSystem: 'ICD-10',
  codeSystemVersion: '2023',
  codes: ['E11.9', 'E11.0'],
  valueSource: 'discharge_dx',
  diagnosisOrder: 'top3_discharge',
};

const goodExpression: AlgorithmExpression = {
  kind: 'and',
  children: [
    { kind: 'codeset', codeset: goodCodeset },
    {
      kind: 'not',
      child: {
        kind: 'codeset',
        codeset: { ...goodCodeset, valueSource: 'medication', codes: ['metformin'] },
      },
    },
  ],
};

describe('grammar-validator — closed-grammar enforcement (D4 / CTL-10)', () => {
  describe('validateCodeSet', () => {
    it('accepts a complete code set with all four §2.7.4 elements', () => {
      expect(() => validateCodeSet(goodCodeset, 'cs')).not.toThrow();
    });

    it.each([
      ['codeSystem', { ...goodCodeset, codeSystem: '' }],
      ['codeSystemVersion', { ...goodCodeset, codeSystemVersion: undefined }],
      ['codes', { ...goodCodeset, codes: 'E11.9' }],
      ['codes', { ...goodCodeset, codes: ['E11.9', 42 as unknown as string] }],
      ['valueSource', { ...goodCodeset, valueSource: 'inpatient_dx' }],
      ['diagnosisOrder', { ...goodCodeset, diagnosisOrder: 'first_two' }],
    ])('rejects when %s is missing/invalid', (_field, bad) => {
      expect(() => validateCodeSet(bad, 'cs')).toThrow(IncompleteCodeSet);
    });
  });

  describe('validateAlgorithmExpression — legal closed grammar', () => {
    it('accepts codeset / and / or / not / window nodes', () => {
      const expr = {
        kind: 'or',
        children: [
          goodExpression,
          {
            kind: 'window',
            days: 30,
            child: {
              kind: 'codeset',
              codeset: { ...goodCodeset, codes: ['I10'] },
            },
          },
        ],
      };
      expect(() => validateAlgorithmExpression(expr)).not.toThrow();
    });
  });

  describe('validateAlgorithmExpression — rejects injection attempts (task 2.2)', () => {
    // The evaluator MUST NOT be called on these. We assert by checking that
    // validateAlgorithmExpression throws BEFORE returning; the consumer (task
    // runner) gates evaluation on this returning successfully.
    it('rejects an inline-script payload masquerading as an expression', () => {
      const malicious = {
        kind: 'codeset',
        source: "process.env.STEAL_KEY",
        codeset: goodCodeset,
      };
      expect(() => validateAlgorithmExpression(malicious)).toThrow(InvalidAlgorithmGrammar);
      expect(() => validateAlgorithmExpression(malicious)).toThrow(/forbidden key "source"/);
    });

    it('rejects a function-call-shaped node', () => {
      const malicious = {
        kind: 'and',
        call: 'eval',
        children: [{ kind: 'codeset', codeset: goodCodeset }],
      };
      expect(() => validateAlgorithmExpression(malicious)).toThrow(/forbidden key "call"/);
    });

    it('rejects a dynamic-eval construct embedded in a string', () => {
      const malicious = {
        kind: 'codeset',
        codeset: { ...goodCodeset, codeSystem: 'eval(x)' },
      };
      expect(() => validateAlgorithmExpression(malicious)).toThrow(/code-like characters/);
    });

    it('rejects arrow-function syntax in any string field', () => {
      const malicious = {
        kind: 'and',
        children: [
          {
            kind: 'codeset',
            codeset: { ...goodCodeset, codeSystem: 'x => x' },
          },
        ],
      };
      expect(() => validateAlgorithmExpression(malicious)).toThrow(/code-like characters/);
    });

    it('rejects __proto__ / constructor keys', () => {
      const malicious = {
        kind: 'codeset',
        codeset: goodCodeset,
        __proto__: null,
      };
      // Object.keys does not enumerate __proto__ set this way on most runtimes,
      // but the constructor-key branch catches the more common variant.
      const malicious2 = {
        kind: 'codeset',
        codeset: goodCodeset,
        constructor: 'Object',
      };
      expect(() => validateAlgorithmExpression(malicious2)).toThrow(/forbidden key "constructor"/);
    });

    it('rejects unknown kind values', () => {
      const malicious = {
        kind: 'javascript',
        children: [{ kind: 'codeset', codeset: goodCodeset }],
      };
      expect(() => validateAlgorithmExpression(malicious)).toThrow(/unknown kind "javascript"/);
    });

    it('rejects non-object expression root', () => {
      // A string payload is caught by the deep code-scan first (good — earlier
      // rejection is safer). Null reaches the shape check.
      expect(() => validateAlgorithmExpression('eval(1)')).toThrow(/code-like characters/);
      expect(() => validateAlgorithmExpression(null)).toThrow(/must be an object/);
    });

    it('rejects window with non-positive days', () => {
      const bad = {
        kind: 'window',
        days: -1,
        child: { kind: 'codeset', codeset: goodCodeset },
      };
      expect(() => validateAlgorithmExpression(bad)).toThrow(/days must be a positive/);
    });
  });

  describe('validateAlgorithmGrammar — top-level wrapper', () => {
    const goodAlgo: IdentificationAlgorithm = {
      id: 'dm2-v1',
      version: '1.0.0',
      expression: goodExpression,
    };

    it('accepts a well-formed algorithm', () => {
      expect(() => validateAlgorithmGrammar(goodAlgo)).not.toThrow();
    });

    it('rejects missing id/version', () => {
      expect(() => validateAlgorithmGrammar({ ...goodAlgo, id: '' })).toThrow(/algorithm.id/);
      expect(() => validateAlgorithmGrammar({ ...goodAlgo, version: '' })).toThrow(/algorithm.version/);
    });

    it('rejects non-positive assessmentWindowDays', () => {
      expect(() =>
        validateAlgorithmGrammar({ ...goodAlgo, assessmentWindowDays: 0 }),
      ).toThrow(/assessmentWindowDays/);
    });
  });
});
