import {
  MdopError,
  ephemeralKeyDigest,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  tcbScheme,
  type AttestationProvider,
  type AttestationReport,
  type Sm2KeyPair,
  type VendorQuote,
} from '@medtrust/mdop';
import type { TeeNodeConfig } from '../config';
import type { HardwareAttestationProviderFactory } from '../providers';
import { fillTdxReportData } from './reportdata';
import { UnwiredTdxQuoteSource, type TdxQuoteResult, type TdxQuoteSource } from './quote-source';

/**
 * TdxAttestationProvider —— 第一条真实硬件证明链的节点侧实现
 * （tdx-attestation-pilot 任务 2.1；跑在 TDVM 内的那一半，design P2）。
 *
 * 职责五件事，多一件不做：
 *  1. 生成**会话级一次性 SM2 密钥对**（实例退出即失效——D-TEE-1「密钥只在该实例内存」）；
 *  2. 按已定案装填约定把 `reportDataBinding(pub)` 的 SM3 写进 64 字节 REPORTDATA；
 *  3. 经 quote source 端口取 quote（真机接线归任务 1.1 / 2.4，本类不感知工具链形状）；
 *  4. 产出符合统一契约的 `VendorQuote` 并经 `mapVendorQuote` 归一化
 *     （`level='hardware'` / `isolation='hardware-enclave'` 由映射得出，不是声明出来的）；
 *  5. 任何失败抛 `E_ATTESTATION_FAILED`——**不降级为软件报告、不出半份证明**。
 *
 * 边界（本类不做的事，别顺手加）：
 *  - collateral **新鲜度**判定是部署侧策略（`CollateralPolicy` + `createHardwareAttestationVerifier`）；
 *    本类只校验**形状齐全**（crl + qvl、摘要合法、时间可解析）——两层分工见 spec 与用例；
 *  - quote 验签链到 Intel 根、REPORTDATA 硬件覆盖核验归信任根（任务 3.1）；
 *  - 院内连接器的 `attestationLevel` 口径（恒 `software`，D9 / CTL-09）与本类无关：
 *    本类服务 C2 可信空间节点（云上 TDVM），不是医院院内平面。
 */

const SM3_LABEL = /^sm3:[0-9a-f]{64}$/;

export interface TdxAttestationProviderOptions {
  /** 本节点（参与方）URN——`VendorQuote.node` 的身份绑定字段，不得缺省。 */
  node: string;
  /** TDX 工具链端口；缺省 = 未接线（`prove()` 即抛错，fail-closed）。 */
  quoteSource?: TdxQuoteSource;
  /** 一次性密钥对工厂（测试注入用）；缺省 `generateSm2KeyPair`。 */
  generateKeyPair?: () => Sm2KeyPair;
  /** 时钟与证明有效期（测试注入用；缺省 5 分钟，与既有替身同 TTL 量级）。 */
  now?: () => Date;
  ttlMs?: number;
}

export class TdxAttestationProvider implements AttestationProvider {
  readonly providerKind = 'tdx' as const;

  private readonly quoteSource: TdxQuoteSource;
  private readonly generateKeyPair: () => Sm2KeyPair;
  private readonly now: () => Date;
  private readonly ttlMs: number;

  /** 最近一次成功 `prove()` 的一次性私钥（会话解封 KMS 信封用；只在实例内存里，D-TEE-1）。 */
  lastEphemeralPrivateKey: string | null = null;

  /**
   * 近几次证明的一次性私钥，按公钥指纹索引（只在实例内存里）。
   * 一次会话里探针、要约复核都会各自 `prove()`，「最近一次」不一定是释放凭据封给的那一把——
   * 解封必须按凭据里的 `ephemeral_key_digest` 取。
   */
  private readonly ephemeralKeys = new Map<string, string>();

  /** 最近一次成功 `prove()` 的原生 quote（base64）与其摘要——校验方要验的是原文，不是摘要。 */
  private lastQuote: { digest: string; quoteBase64: string } | null = null;

  constructor(private readonly opts: TdxAttestationProviderOptions) {
    if (!opts.node)
      throw new MdopError('E_ATTESTATION_FAILED', {}, 'TdxAttestationProvider 缺节点 URN（身份绑定不得缺省）');
    this.quoteSource = opts.quoteSource ?? new UnwiredTdxQuoteSource();
    this.generateKeyPair = opts.generateKeyPair ?? generateSm2KeyPair;
    this.now = opts.now ?? (() => new Date());
    this.ttlMs = opts.ttlMs ?? 300_000;
  }

  async prove(): Promise<AttestationReport> {
    // ① 会话级一次性密钥对
    let pair: Sm2KeyPair;
    try {
      pair = this.generateKeyPair();
    } catch (cause) {
      throw attestationFailed('一次性 SM2 密钥对生成失败', cause);
    }

    // ② 绑定值 + 已定案装填约定（64 字节：前 32 摘要、其余置零）
    const binding = reportDataBinding(pair.publicKey);
    const reportData = fillTdxReportData(binding);

    // ③ 经端口取 quote：端口自身的 E_ATTESTATION_FAILED（如未接线）原样透出，其余包裹
    const result = await this.requestQuote(reportData);

    // ④ 形状校验（quote source 是外部边界，回来的东西不得直接信）
    assertResultShape(result);

    const now = this.now();
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: result.mrtd,
      tcb: result.tcb,
      quote: result.quoteBase64,
      signed_at: now.toISOString(),
      valid_until: new Date(now.getTime() + this.ttlMs).toISOString(),
      ephemeral_public_key: pair.publicKey,
      report_data: binding,
      node: this.opts.node,
      collateral: result.collateral.map((c) => ({ ...c })),
    };

    // ⑤ 归一化（mapVendorQuote 内部会再核 report_data 与公钥的绑定关系）；成功后才留存一次性私钥
    try {
      const report = mapVendorQuote(quote);
      this.lastEphemeralPrivateKey = pair.privateKey;
      this.rememberEphemeral(pair);
      this.lastQuote = report.quote_digest
        ? { digest: report.quote_digest, quoteBase64: result.quoteBase64 }
        : null;
      return report;
    } catch (cause) {
      throw attestationFailed('quote 不满足统一契约（无损映射失败）', cause);
    }
  }

  /**
   * 取某份证明的原生 quote（交给校验方验签用）。只认**最近一次** `prove()` 的那份：
   * 摘要对不上即 `undefined`——不给「拿旧 quote 配新报告」的机会。
   */
  evidenceFor(quoteDigest: string): string | undefined {
    return this.lastQuote?.digest === quoteDigest ? this.lastQuote.quoteBase64 : undefined;
  }

  /** 取某把一次性公钥（按指纹）对应的私钥；不在最近若干次证明之内即 `undefined`。 */
  ephemeralPrivateKeyFor(keyDigest: string): string | undefined {
    return this.ephemeralKeys.get(keyDigest);
  }

  private rememberEphemeral(pair: Sm2KeyPair): void {
    this.ephemeralKeys.set(ephemeralKeyDigest(pair.publicKey), pair.privateKey);
    // 只留最近 8 把：够覆盖一次会话内的并发证明，又不让私钥在内存里无限堆积
    while (this.ephemeralKeys.size > 8)
      this.ephemeralKeys.delete(this.ephemeralKeys.keys().next().value as string);
  }

  private async requestQuote(reportData: Uint8Array): Promise<TdxQuoteResult> {
    try {
      return await this.quoteSource.requestQuote({ reportData });
    } catch (cause) {
      if (cause instanceof MdopError && cause.code === 'E_ATTESTATION_FAILED') throw cause;
      throw attestationFailed('quote source 调用失败', cause);
    }
  }
}

/** 逐项 fail-closed 的形状校验：MRTD、点分 TCB、collateral 齐料。不判时效（那是部署策略）。 */
function assertResultShape(result: TdxQuoteResult): void {
  if (!result.quoteBase64) throw attestationFailed('quote source 未给出 quote 原文（base64）');
  if (!SM3_LABEL.test(result.mrtd))
    throw attestationFailed(`MRTD 度量必须是 sm3:<64hex>，收到：${result.mrtd}`);
  if (tcbScheme(result.tcb) !== 'dotted')
    throw attestationFailed(`TCB 必须是 quote 解析出的点分数字（不得手填/不得年月形态），收到：${result.tcb}`);

  const items = result.collateral ?? [];
  const kinds = new Set(items.map((c) => c.kind));
  for (const kind of ['crl', 'qvl'] as const) {
    if (!kinds.has(kind)) throw attestationFailed(`collateral 缺 ${kind}（TDX 至少 crl + qvl）`);
  }
  for (const item of items) {
    if (!SM3_LABEL.test(item.digest))
      throw attestationFailed(`collateral ${item.kind} 的摘要必须是 sm3:<64hex>（跨网解析会拒，就地先拒）`);
    if (!Number.isFinite(Date.parse(item.fetched_at)) || !Number.isFinite(Date.parse(item.next_update)))
      throw attestationFailed(`collateral ${item.kind} 的时间字段不可解析（等于没有材料）`);
  }
}

function attestationFailed(message: string, cause?: unknown): MdopError {
  const err = new MdopError(
    'E_ATTESTATION_FAILED',
    {},
    `TDX 证明失败（fail-closed，不降级、不出半份证明）：${message}`,
  );
  if (cause !== undefined) (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

/**
 * 装配给 `TeeNodeProviderRegistry.hardwareAttestation` 的工厂形状（任务 4.1 的接线点，
 * 本期不落 registry——4.1 归端到端演练批次）：
 *
 * ```ts
 * registry.hardwareAttestation = tdxProviderFactory({ quoteSource: realSource });
 * ```
 *
 * 节点 URN 取自 `TeeNodeConfig.urn`（部署事实），quote source 由真机侧注入；
 * 不给 quoteSource 即未接线（构造出的 provider 一 `prove()` 就抛错，fail-closed）。
 */
export function tdxProviderFactory(
  opts: Omit<TdxAttestationProviderOptions, 'node'> = {},
): HardwareAttestationProviderFactory {
  return (config: TeeNodeConfig) => new TdxAttestationProvider({ ...opts, node: config.urn });
}
