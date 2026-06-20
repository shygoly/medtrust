import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { ContractService, ContractRequest } from './contract.service';

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
    svc = new ContractService(new GMCryptoService());
  });

  it('approves an active contract with an SM3 hash and future validity', () => {
    const c = svc.approve(req);
    expect(c.status).toBe('active');
    expect(c.hash).toMatch(/^SM3:/);
    expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(svc.effectiveStatus(c)).toBe('active');
  });

  it('reports expired once past validUntil', () => {
    const c = svc.approve({ ...req, validDays: -1 });
    expect(svc.effectiveStatus(c)).toBe('expired');
  });

  it('reports revoked after revoke()', () => {
    const c = svc.approve(req);
    svc.revoke(c.id);
    expect(svc.effectiveStatus(c)).toBe('revoked');
  });
});
