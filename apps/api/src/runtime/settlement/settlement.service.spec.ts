import { SettlementService } from './settlement.service';
import { mockRepo } from '../test-utils/mock-repo';

describe('SettlementService — 按角色查询 (10.5)', () => {
  let svc: SettlementService;
  beforeEach(async () => {
    svc = new SettlementService(mockRepo());
    await svc.onModuleInit(); // seeds st-2990 (consumer pharma-hengrui, providers hospital-huashan/hospital-ruijin)
  });

  it('operator sees the full ledger', async () => {
    const rows = await svc.list({ role: 'operator' });
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toHaveLength(2);
    expect(rows[0].total).toBe(96);
  });

  it('provider sees only its own earning line', async () => {
    const rows = await svc.list({ role: 'provider', participantId: 'hospital-huashan' });
    expect(rows).toHaveLength(1);
    expect(rows[0].earning.amount).toBe(58);
    // does not expose the other provider or the total
    expect(JSON.stringify(rows[0])).not.toContain('瑞金');
    expect(rows[0].total).toBeUndefined();
  });

  it('consumer sees its own charges', async () => {
    const rows = await svc.list({ role: 'consumer', participantId: 'pharma-hengrui' });
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(96);
  });

  it('an unrelated provider sees nothing', async () => {
    expect(await svc.list({ role: 'provider', participantId: 'p-other' })).toHaveLength(0);
  });
});
