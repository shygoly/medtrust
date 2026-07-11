import {
  enrichConditions,
  enrichMedications,
  matchesCondition,
  matchesMedication,
} from './clinical-matching';

describe('clinical-matching', () => {
  it('maps Synthea Metformin strings to 二甲双胍', () => {
    const meds = enrichMedications([
      '24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet',
    ]);
    expect(meds).toContain('二甲双胍');
    expect(matchesMedication(meds, '二甲双胍')).toBe(true);
  });

  it('maps CKD stage 3 queries to normalized 慢性肾病 labels', () => {
    const conds = enrichConditions(['Chronic kidney disease stage 3 (disorder)']);
    expect(conds).toContain('慢性肾病');
    expect(conds).toContain('Chronic kidney disease stage 3');
    expect(matchesCondition(conds, 'Chronic kidney disease stage 3')).toBe(true);
    expect(matchesCondition(['慢性肾病'], 'Chronic kidney disease stage 3')).toBe(true);
  });

  it('maps insulin exposure for L3 TTE arms', () => {
    const meds = enrichMedications(['insulin human 100 UNT/ML Injectable Solution']);
    expect(matchesMedication(meds, '胰岛素')).toBe(true);
  });
});
