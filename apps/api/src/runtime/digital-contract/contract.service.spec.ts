import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { ContractService, ContractRequest } from './contract.service';
import { mockRepo } from '../test-utils/mock-repo';

const req: ContractRequest = {
  dataProductId: 'dp-1',
  providerId: 'p-huashan',
  consumerId: 'p-hengrui',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validDays: 90,
};

describe('ContractService — 数字合约生成与状态 (4.1/4.2)', () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = new ContractService(new GMCryptoService(), mockRepo());
  });

  it('approves an active contract with an SM3 hash and future validity', async () => {
    const c = await svc.approve(req);
    expect(c.status).toBe('active');
    expect(c.hash).toMatch(/^SM3:/);
    expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(svc.effectiveStatus(c)).toBe('active');
  });

  it('reports expired once past validUntil', async () => {
    const c = await svc.approve({ ...req, validDays: -1 });
    expect(svc.effectiveStatus(c)).toBe('expired');
  });

  it('reports revoked after revoke()', async () => {
    const c = await svc.approve(req);
    await svc.revoke(c.id);
    const updated = await svc.get(c.id);
    expect(svc.effectiveStatus(updated!)).toBe('revoked');
  });

  it('seeds active CKD contracts for both demo providers to 恒瑞医药', async () => {
    await svc.onModuleInit();

    const contracts = await svc.list();
    expect(contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: '华山医院',
          consumerId: '恒瑞医药',
          purpose: 'CKD 多中心疗效真实世界研究',
          effectiveStatus: 'active',
        }),
        expect.objectContaining({
          providerId: '瑞金医院',
          consumerId: '恒瑞医药',
          purpose: 'CKD 多中心疗效真实世界研究',
          effectiveStatus: 'active',
        }),
      ]),
    );
  });
});
