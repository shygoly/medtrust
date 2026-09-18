import { computeConfusionMatrixInTee } from './confusion-matrix';
import { TeeEnclave } from '../tee';

describe('confusion-matrix — in-TEE comparison (task 3.2)', () => {
  it('produces TP/FP/TN/FN counts', () => {
    const predictions = new Map<string, boolean>([
      ['s1', true], // TP
      ['s2', true], // FP
      ['s3', false], // TN
      ['s4', false], // FN
    ]);
    const gold = new Map<string, 'positive' | 'negative'>([
      ['s1', 'positive'],
      ['s2', 'negative'],
      ['s3', 'negative'],
      ['s4', 'positive'],
    ]);
    const { confusionMatrix, attestationLevel } = computeConfusionMatrixInTee(predictions, gold);
    expect(confusionMatrix).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(attestationLevel).toBe('software'); // D-RWS-4
  });

  it('skips subjects with no gold-standard annotation', () => {
    const predictions = new Map<string, boolean>([
      ['s1', true],
      ['s2', true], // no gold → skipped
    ]);
    const gold = new Map<string, 'positive' | 'negative'>([['s1', 'positive']]);
    const { confusionMatrix } = computeConfusionMatrixInTee(predictions, gold);
    expect(confusionMatrix).toEqual({ tp: 1, fp: 0, tn: 0, fn: 0 });
  });

  it('returns only 4 counts — no subjectKey leaks through', () => {
    const predictions = new Map<string, boolean>([['subject-foo-bar', true]]);
    const gold = new Map<string, 'positive' | 'negative'>([['subject-foo-bar', 'positive']]);
    const { confusionMatrix } = computeConfusionMatrixInTee(predictions, gold);
    expect(JSON.stringify(confusionMatrix)).not.toContain('subject-foo-bar');
    expect(JSON.stringify(confusionMatrix)).toMatch(/^\{"tp":\d+,"fp":\d+,"tn":\d+,"fn":\d+\}$/);
  });

  it('runs inside a pluggable TEE (attestation level propagates)', () => {
    let ranInside = false;
    const fakeTee: TeeEnclave = {
      seal: (data) => ({ iv: '0', ciphertext: JSON.stringify(data), tag: '0' }),
      run: (sealed, fn) => {
        ranInside = true;
        const data = JSON.parse(sealed.ciphertext);
        return {
          output: fn(data),
          attestation: { enclave: 'fake', measurement: 'm', level: 'software', isolation: 'none' },
        };
      },
    };
    computeConfusionMatrixInTee(new Map(), new Map(), fakeTee);
    expect(ranInside).toBe(true);
  });
});
