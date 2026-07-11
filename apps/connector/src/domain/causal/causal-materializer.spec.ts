import { materializeCausalCohort } from './causal-materializer';
import { InternalRecord, TteSpec } from '../types';

const tte: TteSpec = {
  exposureArm: 'drug:目标药',
  comparatorArm: 'drug:对照药',
  timeZeroRule: 'index_date',
  inclusion: ['age>=18'],
  exclusion: ['pregnancy'],
  outcome: { type: 'time_to_event', event: 'renal_failure' },
};

describe('materializeCausalCohort', () => {
  it('strips subjectKey and maps treated/event flags', () => {
    const rows: InternalRecord[] = [
      {
        subjectKey: 'sk_1',
        ageBand: '50-59',
        sex: 'F',
        medications: ['目标药'],
        conditions: [],
        adverseEvents: [],
        followUpDays: 400,
        eventOccurred: true,
      },
      {
        subjectKey: 'sk_2',
        ageBand: '40-49',
        sex: 'M',
        medications: ['对照药'],
        conditions: [],
        adverseEvents: [],
        followUpDays: 200,
        eventOccurred: false,
      },
    ];
    const cohort = materializeCausalCohort(rows, tte);
    expect(cohort).toHaveLength(2);
    expect(cohort[0].treated).toBe(true);
    expect(cohort[0].eventOccurred).toBe(true);
    expect(JSON.stringify(cohort)).not.toContain('subjectKey');
  });
});
