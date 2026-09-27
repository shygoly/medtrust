import { generateSm2KeyPair } from '@medtrust/mdop';
import { CorpusStore, type CorpusArtifactRecord } from './corpus-store';

describe('CorpusStore（服务计算：长生命周期密封语料管理）', () => {
  const nodeKey = generateSm2KeyPair();
  const nodeUrn = 'urn:medtrust:node:tee-test-01';

  let store: CorpusStore;

  beforeEach(() => {
    store = new CorpusStore({
      node: nodeUrn,
      privateKey: nodeKey.privateKey,
    });
  });

  const sampleCorpus: CorpusArtifactRecord = {
    corpusHandle: 'corpus://contract_101/corpus_alpha',
    contractId: 'contract_101',
    corpusId: 'corpus_alpha',
    label: 'C2',
    digest: 'd'.repeat(64),
    envelope: {
      apiVersion: 'mdop.env/1.0',
      ciphertext: 'encrypted_data_blob',
      key_envelope: { kid: 'kid_session_1', enc_key: 'wrapped_key' },
    },
    provider: 'urn:medtrust:party:hospital-01',
    registeredAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.000Z',
  };

  it('正常写入并读取 C2 密态语料', () => {
    store.put(sampleCorpus);
    const retrieved = store.get(sampleCorpus.corpusHandle);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.contractId).toBe('contract_101');
    expect(retrieved?.corpusId).toBe('corpus_alpha');
    expect(retrieved?.provider).toBe('urn:medtrust:party:hospital-01');

    const byContract = store.getByContractAndCorpus('contract_101', 'corpus_alpha');
    expect(byContract).toEqual(retrieved);
  });

  it('非 C2 等级语料入库被当场拒绝（fail-closed）', () => {
    const invalid = {
      ...sampleCorpus,
      corpusHandle: 'corpus://contract_101/invalid_label',
      label: 'C0' as const,
    };
    expect(() => store.put(invalid as any)).toThrow('必须以 C2 密态信封形式存储');
  });

  it('执行销毁后物理清空数据并出具防篡改签名回执', () => {
    store.put(sampleCorpus);
    expect(store.get(sampleCorpus.corpusHandle)).not.toBeNull();

    const receipt = store.purge({
      contractId: 'contract_101',
      corpusId: 'corpus_alpha',
      reason: 'contract-revoked',
      idempotencyKey: 'idem_purge_01',
    });

    expect(receipt.contract_id).toBe('contract_101');
    expect(receipt.corpus_id).toBe('corpus_alpha');
    expect(receipt.node).toBe(nodeUrn);
    expect(receipt.sig.alg).toBe('SM2-SM3');
    expect(receipt.sig.value).toBeTruthy();

    // 语料已被彻底抹除
    expect(store.get(sampleCorpus.corpusHandle)).toBeNull();

    // 幂等调用返回相同回执
    const secondReceipt = store.purge({
      contractId: 'contract_101',
      corpusId: 'corpus_alpha',
      reason: 'contract-revoked',
      idempotencyKey: 'idem_purge_01',
    });
    expect(secondReceipt).toEqual(receipt);
  });

  it('sweepExpired 清理过期语料', () => {
    const expiredCorpus: CorpusArtifactRecord = {
      ...sampleCorpus,
      corpusHandle: 'corpus://contract_expired/corpus_old',
      contractId: 'contract_expired',
      corpusId: 'corpus_old',
      expiresAt: '2026-05-01T00:00:00.000Z',
    };
    store.put(expiredCorpus);

    const now = new Date('2026-06-01T00:00:00.000Z');
    const receipts = store.sweepExpired(now);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].contract_id).toBe('contract_expired');
    expect(store.get(expiredCorpus.corpusHandle)).toBeNull();
  });
});
