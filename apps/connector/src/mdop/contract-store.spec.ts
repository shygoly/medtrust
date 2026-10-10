import { canonicalize, generateSm2KeyPair, sm2Sign } from '@medtrust/mdop';
import { verifySm2 } from '../domain/sm2-sign';
import { MdopContractStore } from './contract-store';
import { autoConfirmNote, isAutoConfirmAllowed, parsePolicy } from './local-contract-policy';

/** 极简内存仓库（覆盖 create/save/find/findOne/update，主键按字段名判定）。 */
function memRepo(pkField: string) {
  const rows: any[] = [];
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      const arr = Array.isArray(x) ? x : [x];
      for (const item of arr) {
        const idx = rows.findIndex((r) => r[pkField] === item[pkField]);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
        else rows.push(item);
      }
      return x;
    },
    find: async (opts?: any) => (opts?.where ? rows.filter((r) => matches(r, opts.where)) : [...rows]),
    findOne: async (opts: any) => rows.find((r) => matches(r, opts?.where)) ?? null,
    update: async (where: any, patch: any) => {
      let affected = 0;
      for (const r of rows)
        if (matches(r, where)) {
          Object.assign(r, patch);
          affected++;
        }
      return { affected };
    },
  } as any;
}

const CONTRACT_ID = 'ctr-1';
const PURPOSE = 'RWS.EFFECTIVENESS';

function contractJson(over: Record<string, unknown> = {}): string {
  return canonicalize({
    apiVersion: 'mdop/v0.2',
    contract_id: CONTRACT_ID,
    data_product_id: 'dp-1',
    provider: 'p-demohospa',
    consumer: 'p-meddata',
    purpose: PURPOSE,
    retention: '阅后即焚',
    recipients: [
      { party: 'p-demohospa', role: 'final', jurisdiction: 'CN' },
      { party: 'urn:tds:sh-med:participant:platform', role: 'merger', jurisdiction: 'CN' },
    ],
    allowed_ops: ['a'.repeat(64)],
    review: { mode: 'manual', deadline_hours: 72 },
    ethics: { required: false, ref: null, valid_until: null },
    provider_public_key_kid: 'k'.repeat(64),
    platform_public_key_kid: 'p'.repeat(64),
    pre_review_snapshot: null,
    publication: {},
    valid_from: '2026-09-24T00:00:00.000Z',
    valid_until: '2027-09-24T00:00:00.000Z',
    ...over,
  });
}

function store(opts: {
  policy?: ReturnType<typeof parsePolicy>;
  privateKey?: string;
  nodePublicKey?: string;
} = {}) {
  const key = generateSm2KeyPair();
  process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = opts.nodePublicKey ?? key.publicKey;
  const s = new MdopContractStore(
    memRepo('contractId'),
    memRepo('offerId'),
    {
      privateKey: opts.privateKey ?? key.privateKey,
      ...(opts.policy ? { policy: opts.policy } : { policy: parsePolicy({ review: 'manual' }) }),
    },
  );
  return { store: s, keys: key };
}

const OFFER = { offer_id: 'offer-1', contract_id: CONTRACT_ID, canonical: contractJson() };

describe('本地合约库与本地确认（D-MDOP-4 / 任务 5.3-5.5）', () => {
  afterEach(() => {
    delete process.env.CONNECTOR_PLATFORM_NODE_PUBKEY;
  });

  it('缺省人工确认：收到要约只入队，不签、不落本地合约', async () => {
    const { store: s } = store();
    const r = await s.receiveOffer(OFFER);
    expect(r.status).toBe('pending');
    expect(await s.list()).toHaveLength(0);
    expect(await s.listPending()).toHaveLength(1);
    // 复核只认本地副本：此时没有生效副本
    expect(await s.usableContract(CONTRACT_ID)).toEqual({ ok: false, reason: 'missing' });
  });

  it('自动确认只由本地策略点名，且标注 review=auto(policy)', async () => {
    // 策略是 auto，但没点名这个合约 → 仍不自动确认
    const unnamed = store({ policy: parsePolicy({ review: 'auto', autoConfirmContractIds: ['other'] }) });
    expect((await unnamed.store.receiveOffer(OFFER)).status).toBe('pending');

    const named = store({
      policy: parsePolicy({
        review: 'auto',
        autoConfirmContractIds: [CONTRACT_ID],
        note: '演示环境白名单',
      }),
    });
    const r = await named.store.receiveOffer(OFFER);
    expect(r.status).toBe('agreed');
    expect(r.agreement?.review).toBe('auto(policy:演示环境白名单)');
    expect((await named.store.get(CONTRACT_ID))?.reviewPolicy).toBe(
      autoConfirmNote(parsePolicy({ review: 'auto', autoConfirmContractIds: [], note: '演示环境白名单' })),
    );
  });

  it('策略判定只看点名列表；非 auto 一律 false', () => {
    const p = parsePolicy({ review: 'auto', autoConfirmContractIds: ['a'] });
    expect(isAutoConfirmAllowed(p, 'a')).toBe(true);
    expect(isAutoConfirmAllowed(p, 'b')).toBe(false);
    expect(isAutoConfirmAllowed(parsePolicy({ review: 'manual', autoConfirmContractIds: ['a'] }), 'a')).toBe(
      false,
    );
  });

  it('人工确认后用**本院私钥**签署，且签名能被本院公钥验过', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    const agreement = await s.confirm('offer-1', '张主任');
    expect(agreement.canonical).toBe(OFFER.canonical);
    expect(verifySm2(agreement.canonical, agreement.holderSignature, keys.publicKey)).toBe(true);
    // 但平台副署到齐前本地副本仍是 pending，不能授权作业
    expect((await s.usableContract(CONTRACT_ID)).ok).toBe(false);
  });

  it('合约任一字段改动后签名失效', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    const agreement = await s.confirm('offer-1', '张主任');
    const tampered = contractJson({ purpose: 'OTHER.PURPOSE' });
    expect(verifySm2(tampered, agreement.holderSignature, keys.publicKey)).toBe(false);
  });

  it('平台副署必须验签通过才把本地副本置为生效', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    await s.confirm('offer-1', '张主任');
    const good = sm2Sign(OFFER.canonical, keys.privateKey, { publicKey: keys.publicKey });

    // 伪造副署：换一把密钥签 → 必须拒
    const other = generateSm2KeyPair();
    const forged = sm2Sign(OFFER.canonical, other.privateKey, { publicKey: other.publicKey });
    await expect(s.applyCountersignature(CONTRACT_ID, forged)).rejects.toThrow(/验签失败/);
    expect((await s.get(CONTRACT_ID))?.status).toBe('pending');

    // 真副署 → active，可以授权作业
    await s.applyCountersignature(CONTRACT_ID, good);
    expect((await s.get(CONTRACT_ID))?.status).toBe('active');
    expect((await s.usableContract(CONTRACT_ID)).ok).toBe(true);
  });

  it('本地撤销立即生效：此后复核一律拒（与平台是否已知无关）', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    await s.confirm('offer-1', '张主任');
    await s.applyCountersignature(
      CONTRACT_ID,
      sm2Sign(OFFER.canonical, keys.privateKey, { publicKey: keys.publicKey }),
    );
    expect((await s.usableContract(CONTRACT_ID)).ok).toBe(true);

    const notice = await s.revoke(CONTRACT_ID, '张主任', '院内撤回同意');
    expect(notice.contractId).toBe(CONTRACT_ID);
    expect(await s.usableContract(CONTRACT_ID)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('平台终止（ContractTerminate）同样让本地副本立刻不可用', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    await s.confirm('offer-1', '张主任');
    await s.applyCountersignature(
      CONTRACT_ID,
      sm2Sign(OFFER.canonical, keys.privateKey, { publicKey: keys.publicKey }),
    );
    await s.applyTermination(CONTRACT_ID, '平台撤销');
    expect(await s.usableContract(CONTRACT_ID)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('超时视同拒绝', async () => {
    const { store: s } = store();
    await s.receiveOffer(OFFER);
    // 把截止时间推到过去
    const pendingRows = await s.listPending();
    (pendingRows[0] as any).expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(s.confirm('offer-1', '张主任')).rejects.toThrow(/时限已过/);
    expect((await s.listPending()).length).toBe(0);
  });

  it('拒绝要约后不再能被确认', async () => {
    const { store: s } = store();
    await s.receiveOffer(OFFER);
    await s.reject('offer-1', '张主任', '用途不符');
    await expect(s.confirm('offer-1', '张主任')).rejects.toThrow(/已被拒绝/);
  });

  it('至少一次投递：重复要约重发**同一份签名**，不重签、不重复入队', async () => {
    const { store: s, keys } = store();
    await s.receiveOffer(OFFER);
    const first = await s.confirm('offer-1', '张主任');
    // 平台侧重启/重播要约：连接器把原签名再发一次（同一份 canonical + 同一签名）
    const again = await s.receiveOffer(OFFER);
    expect(again.status).toBe('agreed');
    expect(again.agreement?.holderSignature).toBe(first.holderSignature);
    expect(verifySm2(again.agreement!.canonical, again.agreement!.holderSignature, keys.publicKey)).toBe(true);
  });
});
