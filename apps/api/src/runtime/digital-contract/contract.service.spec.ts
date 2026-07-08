import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { ContractService } from './contract.service';
import { mockRepo } from '../test-utils/mock-repo';
import { CatalogService } from '../catalog/catalog.service';

const apply = {
  dataProductId: 'dp-1',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validDays: 90,
};

function mockCatalog(): Pick<CatalogService, 'get'> {
  return {
    get: async (id: string) =>
      id === 'dp-1'
        ? {
            id: 'dp-1',
            urn: 'urn:test',
            homeSpace: 'sh-med',
            providerId: 'p-huashan',
            title: 'test',
            rightsConfirmed: true,
            recordCount: 1,
            fhirSchema: null,
          }
        : null,
  };
}

describe('ContractService — 数字合约生成与状态 (4.1/4.2)', () => {
  let svc: ContractService;
  beforeEach(() => {
    svc = new ContractService(new GMCryptoService(), mockRepo(), mockCatalog() as CatalogService);
  });

  it('approves an active contract with an SM3 hash and future validity', async () => {
    const c = await svc.approve({ ...apply, providerId: 'p-huashan', consumerId: 'p-hengrui' });
    expect(c.status).toBe('active');
    expect(c.hash).toMatch(/^SM3:/);
    expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now());
    expect(svc.effectiveStatus(c)).toBe('active');
  });

  it('reports expired once past validUntil', async () => {
    const c = await svc.approve({ ...apply, providerId: 'p-huashan', consumerId: 'p-hengrui', validDays: -1 });
    expect(svc.effectiveStatus(c)).toBe('expired');
  });

  it('reports revoked after revoke()', async () => {
    const c = await svc.approve({ ...apply, providerId: 'p-huashan', consumerId: 'p-hengrui' });
    await svc.revoke(c.id);
    const updated = await svc.get(c.id);
    expect(svc.effectiveStatus(updated!)).toBe('revoked');
  });

  it('consumer request creates a draft; provider approves to active', async () => {
    const draft = await svc.request(apply, 'p-hengrui');
    expect(draft.providerId).toBe('p-huashan');
    expect(draft.status).toBe('draft');
    expect(svc.effectiveStatus(draft)).toBe('draft');

    const active = await svc.approveDraft(draft.id, 'p-huashan');
    expect(active.status).toBe('active');
    expect(active.hash).toMatch(/^SM3:/);
  });

  it('provider rejects a draft', async () => {
    const draft = await svc.request(apply, 'p-hengrui');
    const rejected = await svc.rejectDraft(draft.id, 'p-huashan');
    expect(rejected.status).toBe('revoked');
  });

  it('list sets canApprove for matching provider on draft', async () => {
    const draft = await svc.request(apply, 'p-hengrui');
    const forRuijin = await svc.list({ role: 'provider', participantId: 'p-ruijin' });
    expect(forRuijin.find((c) => c.id === draft.id)?.canApprove).toBe(false);

    const forHuashan = await svc.list({ role: 'provider', participantId: 'p-huashan' });
    expect(forHuashan.find((c) => c.id === draft.id)?.canApprove).toBe(true);

    const forHuashanOrg = await svc.list({ role: 'provider', participantId: '华山医院' });
    expect(forHuashanOrg.find((c) => c.id === draft.id)?.canApprove).toBe(true);
  });

  it('seeds active CKD contracts for both demo providers to p-meddata', async () => {
    await svc.onModuleInit();

    const contracts = await svc.list();
    expect(contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'p-huashan',
          consumerId: 'p-meddata',
          purpose: 'CKD 多中心疗效真实世界研究',
          effectiveStatus: 'active',
        }),
        expect.objectContaining({
          providerId: 'p-ruijin',
          consumerId: 'p-meddata',
          purpose: 'CKD 多中心疗效真实世界研究',
          effectiveStatus: 'active',
        }),
      ]),
    );
  });
});
