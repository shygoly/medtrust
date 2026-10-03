import {
  MdopError,
  createHardwareAttestationVerifier,
  evaluateCollateralFreshness,
  generateSm2KeyPair,
  mapVendorQuote,
  publicKeyFromPrivateKey,
  reportDataBinding,
  sm3Hex,
  type AttestationCollateral,
  type CollateralPolicy,
  type TrustedRootWithCollateral,
  type VendorQuote,
} from '@medtrust/mdop';
import type { TeeNodeConfig } from '../config';
import { nodeCapabilityAdvertisement } from '../providers';
import { UnwiredTdxQuoteSource } from './quote-source';
import type { TdxQuoteRequest, TdxQuoteResult, TdxQuoteSource } from './quote-source';
import { TdxAttestationProvider, tdxProviderFactory } from './provider';
import {
  TDX_REPORTDATA_BYTES,
  TDX_REPORTDATA_DIGEST_BYTES,
  extractTdxReportData,
  fillTdxReportData,
} from './reportdata';

/**
 * TdxAttestationProvider 单元测试（tdx-attestation-pilot 任务 2.1 / 2.3；含 4.4 的单测面）。
 *
 * 全部用 stub quote source——真机冒烟归任务 2.4（D-TEE-3 ② 解除条件），软件替身不得
 * 用来勾真机条目（tasks.md 头部口径）。覆盖四组：
 *  ① REPORTDATA 装填约定：fill/extract 往返 + 形状负例；
 *  ② prove() 产出：VendorQuote 字段来源逐项断言、mapVendorQuote 无损映射、一次性密钥会话级；
 *  ③ fail-closed 负例：未接线/端口失败/字段形状坏/缺料——一律 E_ATTESTATION_FAILED，不出半份证明；
 *  ④ collateral 分层：形状归提供者（prove 时校验）、时效归部署策略
 *    （evaluateCollateralFreshness / createHardwareAttestationVerifier）；
 *  ⑤ 能力通告（4.4 单测面）：tee{kind,min_tcb} 由真跑一次证明得出。
 */

const NOW = new Date('2026-09-27T10:00:00.000Z');
const NODE = 'urn:tds:sh-med:participant:tee-tdx-1';
const MRTD = `sm3:${'a'.repeat(64)}`;
const TCB = '8.1.0';
const QUOTE_B64 = 'dGR4LXF1b3RlLXN0dWItMDE=';
const COLLATERAL_POLICY: CollateralPolicy = {
  required: ['crl', 'qvl'],
  max_staleness_minutes: 24 * 60,
};

/** 一份信任材料：30 分钟前取回、12 小时后到期（新鲜）。参数化供过期/超窗用例复用。 */
function material(
  kind: 'crl' | 'qvl',
  fetchedMinutesAgo: number,
  nextUpdateInMinutes: number,
): AttestationCollateral {
  return {
    kind,
    digest: `sm3:${(kind === 'crl' ? '1' : '2').repeat(64)}`,
    fetched_at: new Date(NOW.getTime() - fetchedMinutesAgo * 60_000).toISOString(),
    next_update: new Date(NOW.getTime() + nextUpdateInMinutes * 60_000).toISOString(),
  };
}

const freshCollateral = () => [material('crl', 30, 12 * 60), material('qvl', 30, 12 * 60)];

/** stub quote source：返回形状齐全的 TDX 结果；over 可逐字段制造负例（含置 undefined）。 */
class StubTdxQuoteSource implements TdxQuoteSource {
  readonly requests: TdxQuoteRequest[] = [];
  constructor(private readonly over: Partial<TdxQuoteResult> = {}) {}
  async requestQuote(request: TdxQuoteRequest): Promise<TdxQuoteResult> {
    this.requests.push({ reportData: request.reportData });
    const base: TdxQuoteResult = {
      quoteBase64: QUOTE_B64,
      mrtd: MRTD,
      tcb: TCB,
      collateral: freshCollateral(),
    };
    return { ...base, ...this.over } as TdxQuoteResult;
  }
}

class FailingTdxQuoteSource implements TdxQuoteSource {
  constructor(private readonly error: unknown = new Error('工具链崩了')) {}
  async requestQuote(): Promise<TdxQuoteResult> {
    throw this.error;
  }
}

/** 统一的 fail-closed 断言：必须抛 E_ATTESTATION_FAILED（可附消息匹配），不抛即用例失败。 */
async function expectAttestationFailure(run: () => Promise<unknown>, message?: RegExp): Promise<MdopError> {
  try {
    await run();
  } catch (error) {
    const err = error as MdopError;
    expect(err).toBeInstanceOf(MdopError);
    expect(err.code).toBe('E_ATTESTATION_FAILED');
    if (message) expect(err.message).toMatch(message);
    return err;
  }
  throw new Error('预期 fail-closed 抛错，但调用成功了（不得降级、不得出半份证明）');
}

function makeProvider(quoteSource: TdxQuoteSource, node = NODE): TdxAttestationProvider {
  return new TdxAttestationProvider({ node, quoteSource, now: () => NOW });
}

describe('TDX REPORTDATA 装填约定（fill/extract 纯函数）', () => {
  it('装填：前 32 字节 = 绑定摘要的 SM3 字节、其余置零；还原：往返一致', () => {
    for (let i = 0; i < 3; i += 1) {
      const binding = reportDataBinding(generateSm2KeyPair().publicKey);
      const bytes = fillTdxReportData(binding);
      expect(bytes).toHaveLength(TDX_REPORTDATA_BYTES);

      const digestHex = binding.slice('sm3:'.length);
      for (let j = 0; j < TDX_REPORTDATA_DIGEST_BYTES; j += 1)
        expect(bytes[j]).toBe(parseInt(digestHex.substr(j * 2, 2), 16));
      for (let j = TDX_REPORTDATA_DIGEST_BYTES; j < TDX_REPORTDATA_BYTES; j += 1) expect(bytes[j]).toBe(0);

      expect(extractTdxReportData(bytes)).toBe(binding);
    }
  });

  it('装填拒绝非 sm3 摘要标签（E_AUTH_INVALID——实现 bug 才会走到）', () => {
    expect(() => fillTdxReportData(`sha256:${'a'.repeat(64)}`)).toThrow(/E_AUTH_INVALID/);
  });

  it('还原拒绝长度不为 64 的输入（E_ATTESTATION_FAILED）', () => {
    const good = fillTdxReportData(reportDataBinding(generateSm2KeyPair().publicKey));
    expect(() => extractTdxReportData(good.slice(0, 63))).toThrow(/64 字节/);
    const padded = new Uint8Array(65);
    padded.set(good, 0);
    expect(() => extractTdxReportData(padded)).toThrow(/64 字节/);
  });

  it('还原拒绝尾部非零字节（约定「其余置零」，不得只看前 32 字节就当比对通过）', () => {
    const bytes = fillTdxReportData(reportDataBinding(generateSm2KeyPair().publicKey));
    bytes[40] = 1;
    expect(() => extractTdxReportData(bytes)).toThrow(/置零/);
  });
});

describe('prove()：VendorQuote 的产生与无损映射（任务 2.1 / 2.3）', () => {
  it('成功产出：字段逐项来自 quote source 与一次性密钥对；level/isolation 由映射得出', async () => {
    const report = await makeProvider(new StubTdxQuoteSource()).prove();

    expect(report.kind).toBe('tdx');
    // level/isolation 是 mapVendorQuote 的结论（对硬件 quote 的映射），不是本类的声明
    expect(report.level).toBe('hardware');
    expect(report.isolation).toBe('hardware-enclave');
    expect(report.measurement).toBe(MRTD);
    expect(report.tcb).toBe(TCB); // 来自 quote source 解析，未手填
    expect(report.node).toBe(NODE);
    expect(report.quote_digest).toBe(`sm3:${sm3Hex(QUOTE_B64)}`);
    expect(report.issued_at).toBe(NOW.toISOString());
    expect(report.expires_at).toBe(new Date(NOW.getTime() + 300_000).toISOString());
    expect((report.collateral ?? []).map((c) => c.kind).sort()).toEqual(['crl', 'qvl']);
  });

  it('一次性公钥与绑定值自洽，lastEphemeralPrivateKey 与该公钥配对（会话解封用）', async () => {
    const provider = makeProvider(new StubTdxQuoteSource());
    const report = await provider.prove();
    expect(report.report_data).toBe(reportDataBinding(report.ephemeral_public_key!));
    expect(publicKeyFromPrivateKey(provider.lastEphemeralPrivateKey!)).toBe(report.ephemeral_public_key);
  });

  it('无损映射：与手工构造同一份 TDX 样例 VendorQuote 的 mapVendorQuote 结果逐字段相等', async () => {
    const pair = generateSm2KeyPair();
    const provider = new TdxAttestationProvider({
      node: NODE,
      quoteSource: new StubTdxQuoteSource(),
      generateKeyPair: () => pair,
      now: () => NOW,
    });
    const report = await provider.prove();

    const sample: VendorQuote = {
      vendor: 'tdx',
      measurement: MRTD,
      tcb: TCB,
      quote: QUOTE_B64,
      signed_at: NOW.toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: pair.publicKey,
      report_data: reportDataBinding(pair.publicKey),
      node: NODE,
      collateral: freshCollateral(),
    };
    expect(mapVendorQuote(sample)).toEqual(report);
  });

  it('协议负例：VendorQuote 缺 report_data → mapVendorQuote 拒（不出半份证明）', () => {
    const pair = generateSm2KeyPair();
    const sample = {
      vendor: 'tdx',
      measurement: MRTD,
      tcb: TCB,
      quote: QUOTE_B64,
      signed_at: NOW.toISOString(),
      valid_until: new Date(NOW.getTime() + 300_000).toISOString(),
      ephemeral_public_key: pair.publicKey,
      node: NODE,
    } as unknown as VendorQuote;
    expect(() => mapVendorQuote(sample)).toThrow(/report_data/);
  });

  it('送进 quote 的 REPORTDATA 按约定装填，且从它还原出的绑定值 = 报告的 report_data', async () => {
    const source = new StubTdxQuoteSource();
    const report = await makeProvider(source).prove();
    expect(source.requests).toHaveLength(1);
    const sent = source.requests[0].reportData;
    expect(sent).toHaveLength(TDX_REPORTDATA_BYTES);
    // 装填约定的自洽：硬件覆盖的数据（送进 quote 的 64 字节）与协议字段同源
    expect(extractTdxReportData(sent)).toBe(report.report_data);
  });

  it('每次证明都是新的一次性密钥对（会话级，不复用）', async () => {
    const provider = makeProvider(new StubTdxQuoteSource());
    const first = await provider.prove();
    const second = await provider.prove();
    expect(first.ephemeral_public_key).not.toBe(second.ephemeral_public_key);
    expect(second.report_data).toBe(reportDataBinding(second.ephemeral_public_key!));
  });
});

describe('fail-closed：prove() 的负例（不降级、不出半份证明）', () => {
  it('缺省未接线（UnwiredTdxQuoteSource）→ E_ATTESTATION_FAILED，且不残留一次性私钥', async () => {
    const provider = new TdxAttestationProvider({ node: NODE, now: () => NOW });
    await expectAttestationFailure(() => provider.prove(), /未接线/);
    expect(provider.lastEphemeralPrivateKey).toBeNull();
  });

  it('quote source 抛普通错误 → 包裹为 E_ATTESTATION_FAILED（不裸抛、不吞错）', async () => {
    const provider = makeProvider(new FailingTdxQuoteSource(new Error('boom')));
    await expectAttestationFailure(() => provider.prove(), /quote source 调用失败/);
  });

  it('quote source 自报 E_ATTESTATION_FAILED → 原样透出（未接线等口径不被包装吞掉）', async () => {
    const provider = makeProvider(
      new FailingTdxQuoteSource(new MdopError('E_ATTESTATION_FAILED', {}, '端口自报失败')),
    );
    await expectAttestationFailure(() => provider.prove(), /端口自报失败/);
  });

  it('MRTD 形状错（非 sm3:<64hex>）→ 拒', async () => {
    const provider = makeProvider(new StubTdxQuoteSource({ mrtd: `sha256:${'a'.repeat(64)}` }));
    await expectAttestationFailure(() => provider.prove(), /MRTD/);
  });

  it('TCB 非点分数字（年月/垃圾形态）→ 拒（必须来自 quote 解析，不得混版本体系）', async () => {
    const ym = makeProvider(new StubTdxQuoteSource({ tcb: '2026-06' }));
    await expectAttestationFailure(() => ym.prove(), /点分/);
    const junk = makeProvider(new StubTdxQuoteSource({ tcb: 'v3.1-beta' }));
    await expectAttestationFailure(() => junk.prove(), /点分/);
  });

  it('collateral 缺 qvl（只有 crl）→ 拒', async () => {
    const provider = makeProvider(new StubTdxQuoteSource({ collateral: [material('crl', 30, 12 * 60)] }));
    await expectAttestationFailure(() => provider.prove(), /缺 qvl/);
  });

  it('collateral 整体未随带 → 拒（缺料即拒，不退化成「有几样算几样」）', async () => {
    const provider = makeProvider(new StubTdxQuoteSource({ collateral: undefined }));
    await expectAttestationFailure(() => provider.prove(), /缺 crl/);
  });

  it('collateral 摘要形状坏 → 拒（跨网解析会拒，就地先拒）', async () => {
    const bad = [
      { ...material('crl', 30, 12 * 60), digest: `md5:${'z'.repeat(32)}` },
      material('qvl', 30, 12 * 60),
    ];
    const provider = makeProvider(new StubTdxQuoteSource({ collateral: bad }));
    await expectAttestationFailure(() => provider.prove(), /摘要/);
  });

  it('collateral 时间字段不可解析 → 拒（等于没有材料）', async () => {
    const bad = [
      material('crl', 30, 12 * 60),
      { ...material('qvl', 30, 12 * 60), fetched_at: 'not-a-date' },
    ];
    const provider = makeProvider(new StubTdxQuoteSource({ collateral: bad }));
    await expectAttestationFailure(() => provider.prove(), /时间字段/);
  });
});

describe('collateral 分层：形状归提供者、时效归部署策略（evaluateCollateralFreshness 口径）', () => {
  // 信任根替身：验签链到 Intel 根归任务 3.1（真实 TDX 根），这里恒 true——只让「新鲜度那一半」说话
  const stubRoot: TrustedRootWithCollateral = {
    kind: 'tdx',
    collateral: COLLATERAL_POLICY,
    verifyQuoteDigest: () => true,
  };
  const verifier = createHardwareAttestationVerifier([stubRoot], () => NOW);

  it('新鲜材料随证明 → 新鲜度判定 ok，真实形状校验器放行（KMS 释放判据可满足）', async () => {
    const report = await makeProvider(new StubTdxQuoteSource()).prove();
    expect(
      evaluateCollateralFreshness({ collateral: report.collateral, policy: COLLATERAL_POLICY, now: NOW }),
    ).toEqual({ ok: true });
    expect(verifier.verify(report)).toBe(true);
  });

  it('材料过 next_update → 证明可产出（形状齐全），但新鲜度拒、校验器拒（云上在线可取不是放宽的理由）', async () => {
    const provider = makeProvider(
      new StubTdxQuoteSource({ collateral: [material('crl', 30, -5), material('qvl', 30, -5)] }),
    );
    const report = await provider.prove();
    const verdict = evaluateCollateralFreshness({
      collateral: report.collateral,
      policy: COLLATERAL_POLICY,
      now: NOW,
    });
    if (verdict.ok) throw new Error('过 next_update 的材料应判不新鲜');
    expect(verdict.reason).toMatch(/已过期/);
    expect(verifier.verify(report)).toBe(false);
  });

  it('材料超出离线刷新窗口 → 拒（窗口判据独立于过期判据）', async () => {
    const provider = makeProvider(
      new StubTdxQuoteSource({
        collateral: [material('crl', 25 * 60, 12 * 60), material('qvl', 25 * 60, 12 * 60)],
      }),
    );
    const report = await provider.prove();
    const verdict = evaluateCollateralFreshness({
      collateral: report.collateral,
      policy: COLLATERAL_POLICY,
      now: NOW,
    });
    if (verdict.ok) throw new Error('超出刷新窗口的材料应判不新鲜');
    expect(verdict.reason).toMatch(/刷新窗口/);
    expect(verifier.verify(report)).toBe(false);
  });
});

describe('能力通告由真跑证明得出（任务 4.4 的单测面）', () => {
  it('硬件级报告 → tee{kind, min_tcb} 取自报告本身（配置写什么骗不过通告）', async () => {
    const provider = makeProvider(new StubTdxQuoteSource({ tcb: '8.2.1' }));
    const adv = await nodeCapabilityAdvertisement({
      provider,
      runtime: ['native'],
      systemOps: [],
      whitelistDigests: [],
    });
    expect(adv.tee).toEqual({ kind: 'tdx', min_tcb: '8.2.1' });
  });

  it('证明跑不通（未接线）→ 广告不产出：宁可失败，也不发 tee:null 的假通告', async () => {
    const provider = new TdxAttestationProvider({ node: NODE, now: () => NOW });
    await expectAttestationFailure(() =>
      nodeCapabilityAdvertisement({ provider, runtime: ['native'], systemOps: [], whitelistDigests: [] }),
    /未接线/,
    );
  });
});

describe('tdxProviderFactory：TeeNodeProviderRegistry.hardwareAttestation 的接线形状（任务 4.1 预备）', () => {
  it('节点 URN 取自 TeeNodeConfig（部署事实），prove 正常产出', async () => {
    const factory = tdxProviderFactory({ quoteSource: new StubTdxQuoteSource(), now: () => NOW });
    const provider = factory({ urn: NODE } as TeeNodeConfig);
    expect(provider.providerKind).toBe('tdx');
    const report = await provider.prove();
    expect(report.node).toBe(NODE);
  });

  it('不给 quoteSource 的工厂产物 = 未接线（prove 即抛，fail-closed 贯穿到 registry）', async () => {
    const provider = tdxProviderFactory({ now: () => NOW })({ urn: NODE } as TeeNodeConfig);
    await expectAttestationFailure(() => provider.prove(), /未接线/);
  });
});

/** 直接 import 未接线缺省实现，锁住其自描述口径（任务 1.1/2.4 前的诚实边界）。 */
describe('UnwiredTdxQuoteSource：缺省实现自描述', () => {
  it('抛 E_ATTESTATION_FAILED 且消息指向真机接线任务', async () => {
    const source = new UnwiredTdxQuoteSource();
    await expectAttestationFailure(() => source.requestQuote({ reportData: new Uint8Array(64) }), /未接线/);
  });
});
