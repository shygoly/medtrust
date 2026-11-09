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

  it('预授权规则（Predicate）：按条款自动签，合约 id 不需要预先点名（Phase 3 自动创建）', async () => {
    // 医院本地策略：这家使用方 + 这个产品 + 这个用途 + 有效期 ≤ 60 天 + minCell ≥ 5 → 自动签
    const policy = parsePolicy({
      review: 'auto',
      autoConfirmContractIds: [],
      autoConfirmRules: [
        {
          label: '与创新药企的常规 RWS',
          dataProductId: 'dp-1',
          consumerId: 'p-meddata',
          purpose: PURPOSE,
          maxValidDays: 60,
          minMinCell: 5,
        },
      ],
      note: '院内预授权',
    });
    // 带 minCell=5、有效期 25 天（都在预授权范围内）的合约。
    // 注意：`now` 用**真实当前时间**——confirm() 会按复核时限判超时，用一个过去的假时间
    // 会让"自动签"这条路被误判成"超时视同拒绝"（实测踩到）。
    const offer = {
      offer_id: 'offer-pred-1',
      contract_id: 'ct-brand-new-id',
      canonical: contractJson({
        publication: { minCell: 5 },
        valid_until: new Date(Date.now() + 25 * 86_400_000).toISOString(),
      }),
    };
    const r = await store({ policy }).store.receiveOffer(offer);

    expect(r.status).toBe('agreed');
    // 留痕写清是哪一条预授权放的行
    expect(r.agreement?.review).toBe('auto(policy:院内预授权#与创新药企的常规 RWS)');
  });

  it('预授权规则不匹配即落回人工（fail-closed）：条文一变就不自动签', async () => {
    const policy = parsePolicy({
      review: 'auto',
      autoConfirmContractIds: [],
      autoConfirmRules: [{ dataProductId: 'dp-1', consumerId: 'p-meddata', maxValidDays: 60 }],
    });

    // ① 别的使用方
    expect(
      (
        await store({ policy }).store.receiveOffer({
          offer_id: 'o1',
          contract_id: 'ct-a',
          canonical: contractJson({ contract_id: 'ct-a', consumer: 'p-other' }),
        })
      ).status,
    ).toBe('pending');

    // ② 别的产品
    expect(
      (
        await store({ policy }).store.receiveOffer({
          offer_id: 'o2',
          contract_id: 'ct-b',
          canonical: contractJson({ contract_id: 'ct-b', data_product_id: 'dp-other' }),
        })
      ).status,
    ).toBe('pending');

    // ③ 有效期超出预授权上限（规则 60 天，合约 10 年）
    expect(
      (
        await store({ policy }).store.receiveOffer({
          offer_id: 'o3',
          contract_id: 'ct-c',
          canonical: contractJson({ contract_id: 'ct-c', valid_until: '2036-09-24T00:00:00.000Z' }),
        })
      ).status,
    ).toBe('pending');

    // ④ 规则要求 minCell ≥ 10，合约只声明 5
    const minCellPolicy = parsePolicy({
      review: 'auto',
      autoConfirmContractIds: [],
      autoConfirmRules: [{ dataProductId: 'dp-1', minMinCell: 10 }],
    });
    expect(
      (
        await store({ policy: minCellPolicy }).store.receiveOffer({
          offer_id: 'o4',
          contract_id: 'ct-d',
          canonical: contractJson({ contract_id: 'ct-d', publication: { minCell: 5 } }),
        })
      ).status,
    ).toBe('pending');
  });

  it('空谓词规则在解析期就被拒（否则等于"什么都自动签"）', () => {
    expect(() => parsePolicy({ review: 'auto', autoConfirmRules: [{}] })).toThrow(/空规则/);
    expect(() => parsePolicy({ review: 'auto', autoConfirmRules: 'nope' })).toThrow(/必须是数组/);
    expect(() =>
      parsePolicy({ review: 'auto', autoConfirmRules: [{ maxValidDays: -1 }] }),
    ).toThrow(/正数/);
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

describe('待确认列表：过期要约', () => {
  it('列表直接过滤过期要约并落 expired；过期后即使直接调 confirm 也不能签', async () => {
    const s = store().store;
    await s.receiveOffer(OFFER);
    const [row] = await s.listPending();
    (row as any).expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await s.listPending()).toHaveLength(0);
    await expect(s.confirm(row.offerId, '张主任')).rejects.toThrow(/时限已过/);
    // 重复确认仍被拒（不会因为状态变化变成可签）
    await expect(s.confirm(row.offerId, '张主任')).rejects.toThrow(/时限已过/);
  });
});
