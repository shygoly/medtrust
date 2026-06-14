import { SettlementService } from './settlement.service';

describe('SettlementService — 按角色查询 (10.5)', () => {
  let svc: SettlementService;
  beforeEach(() => {
    svc = new SettlementService(); // seeds st-2041 (consumer p-meddata, providers p-huashan/p-ruijin)
  });

  it('operator sees the full ledger', () => {
    const rows = svc.list({ role: 'operator' });
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toHaveLength(2);
    expect(rows[0].total).toBe(96);
  });

  it('provider sees only its own earning line', () => {
    const rows = svc.list({ role: 'provider', participantId: 'p-huashan' });
    expect(rows).toHaveLength(1);
    expect(rows[0].earning.amount).toBe(58);
    // does not expose the other provider or the total
    expect(JSON.stringify(rows[0])).not.toContain('瑞金');
    expect(rows[0].total).toBeUndefined();
  });

  it('consumer sees its own charges', () => {
    const rows = svc.list({ role: 'consumer', participantId: 'p-meddata' });
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(96);
  });

  it('an unrelated provider sees nothing', () => {
    expect(svc.list({ role: 'provider', participantId: 'p-other' })).toHaveLength(0);
  });
});
