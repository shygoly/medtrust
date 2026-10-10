import {
  canonicalize,
  generateSm2KeyPair,
  parseMdopContract,
  publicKeyKid,
  sm2Sign,
  type MdopContract,
} from '@medtrust/mdop';
import { NodeContractStore } from './contract-store';

/**
 * 节点侧合约副本（任务 3.15）：**两条签名都要过、公钥都不取自消息**。
 */

const PLATFORM = generateSm2KeyPair();
const HOLDER = generateSm2KeyPair();
const SPACE = 'sh-med';

function contract(over: Partial<MdopContract> = {}): MdopContract {
  return parseMdopContract({
    apiVersion: 'mdop/v0.2',
    contract_id: 'ctr-node-1',
    data_product_id: 'dp-1',
    provider: `urn:tds:${SPACE}:participant:p-demohospa`,
    consumer: `urn:tds:${SPACE}:participant:p-meddata`,
    purpose: 'RWS.EFFECTIVENESS',
    retention: '阅后即焚',
    recipients: [
      { party: `urn:tds:${SPACE}:participant:platform`, role: 'merger', jurisdiction: 'CN' },
      { party: `urn:tds:${SPACE}:participant:p-demohospa`, role: 'final', jurisdiction: 'CN' },
    ],
    allowed_ops: [`sm3:${'a'.repeat(64)}`],
    review: { mode: 'auto', deadline_hours: 24 },
    ethics: { required: false, ref: null, valid_until: null },
    provider_public_key_kid: publicKeyKid(HOLDER.publicKey),
    platform_public_key_kid: publicKeyKid(PLATFORM.publicKey),
    pre_review_snapshot: null,
    publication: { minCell: 10 },
    valid_from: '2026-09-01T00:00:00.000Z',
    valid_until: '2027-09-01T00:00:00.000Z',
    attestation_policy: { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } },
    ...over,
  });
}

function signed(over: Partial<MdopContract> = {}) {
  const c = contract(over);
  const canonical = canonicalize(c);
  return {
    canonical,
    holderSignature: sm2Sign(canonical, HOLDER.privateKey, { publicKey: HOLDER.publicKey }),
    platformCountersignature: sm2Sign(canonical, PLATFORM.privateKey, {
      publicKey: PLATFORM.publicKey,
    }),
  };
}

describe('节点侧合约副本（任务 3.15）', () => {
  it('两签都对 → 存档，并能取出可喂给会话的条款（含 recipients）', () => {
    const store = new NodeContractStore();
    const copy = store.verifyAndStore({
      ...signed(),
      platformPublicKey: PLATFORM.publicKey,
      holderPublicKey: HOLDER.publicKey,
    });
    expect(copy.contractId).toBe('ctr-node-1');
    const terms = store.requireForSession('ctr-node-1');
    expect(terms.data_product_id).toBe('dp-1');
    expect(terms.allowed_ops).toEqual([`sm3:${'a'.repeat(64)}`]);
    expect(terms.attestation_policy).toEqual({ tee: ['tdx'], min_tcb: { tdx: '3.1.0' } });
    expect(terms.recipients).toContain(`urn:tds:${SPACE}:participant:platform`);
  });

  it('平台副署不是该平台的（换了公钥）→ 拒，且不存档', () => {
    const store = new NodeContractStore();
    const other = generateSm2KeyPair();
    expect(() =>
      store.verifyAndStore({
        ...signed(),
        platformPublicKey: other.publicKey,
        holderPublicKey: HOLDER.publicKey,
      }),
    ).toThrow(/平台副署验签失败/);
    expect(store.list()).toHaveLength(0);
  });

  it('持有方公钥与条款登记的指纹不符 → 拒（不得换公钥顶替）', () => {
    const store = new NodeContractStore();
    const other = generateSm2KeyPair();
    expect(() =>
      store.verifyAndStore({
        ...signed(),
        platformPublicKey: PLATFORM.publicKey,
        holderPublicKey: other.publicKey,
      }),
    ).toThrow(/指纹不符/);
  });

  it('条款被改（canonical 与签名不匹配）→ 持有方签名验不过 → 拒', () => {
    const store = new NodeContractStore();
    const s = signed();
    const tampered = { ...JSON.parse(s.canonical) as Record<string, unknown>, publication: { minCell: 1 } };
    expect(() =>
      store.verifyAndStore({
        ...s,
        canonical: JSON.stringify(tampered),
        platformPublicKey: PLATFORM.publicKey,
        holderPublicKey: HOLDER.publicKey,
      }),
    ).toThrow(/平台副署验签失败|持有方签名验签失败/);
  });

  it('没有验过的副本 → requireForSession 直接拒（fail-closed）', () => {
    const store = new NodeContractStore();
    expect(() => store.requireForSession('ctr-unknown')).toThrow(/没有验过的合约副本/);
  });

  it('缺平台公钥或缺持有方公钥 → 拒（不拿「能不能验」碰运气）', () => {
    const store = new NodeContractStore();
    expect(() =>
      store.verifyAndStore({ ...signed(), platformPublicKey: '', holderPublicKey: HOLDER.publicKey }),
    ).toThrow(/未配置平台公钥/);
    expect(() =>
      store.verifyAndStore({ ...signed(), platformPublicKey: PLATFORM.publicKey, holderPublicKey: '' }),
    ).toThrow(/缺少持有方登记公钥/);
  });
});
