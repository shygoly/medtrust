import {
  LocalDevKms,
  MdopError,
  compareTcb,
  createHardwareAttestationVerifier,
  parseAttestationReport,
  reportDataBinding,
  signEndorsementPush,
  sm2Decrypt,
  sm3Hex,
  type AttestationPolicy,
  type AttestationReport,
  type AttestationVerifier,
  type EndorsementPush,
  type KeyReleaseWarrant,
  type TrustedRootWithCollateral,
} from '@medtrust/mdop';
import { stableStringify } from '../domain/canonical-json';
import { verifySm2 } from '../domain/sm2-sign';
import { extractTdxReportData } from '../tee-node/tdx/reportdata';
import { parseQuoteFacts, type SidecarRunner, type TdxQuoteFacts } from '../tee-node/tdx/sidecar';

/**
 * 校验方（证明服务）的判定核心（tdx-attestation-pilot 任务 3.1–3.3 / 4.5；design P3）。
 *
 * 节点的证明探针把「统一证明报告 + 原生 quote」交过来，这里做完下面每一步才签背书，
 * 任何一步不过即拒（fail-closed，不出半份背书）：
 *
 *  1. 探针认证：`ts:pid` 的 SM2 签名用**部署配置里登记的节点公钥**验（不取自消息），时间窗内；
 *  2. 报告形状严格解析；身份绑定：报告的 `node` = 认证出的节点；
 *  3. `sm3(quote 原文)` = 报告的 `quote_digest`（背书的就是这份原文）；
 *  4. sidecar 验签链到 Intel 证明根（collateral 由**校验方自己**向 Intel PCS 取，不信节点带来的料）；
 *  5. 硬件覆盖核验：从**原始 quote** 取出的 REPORTDATA = 报告的 `report_data`
 *     = `reportDataBinding(一次性公钥)`；度量与 TCB 以 quote 解析值为准，报告自述不符即拒；
 *  6. 部署策略：度量在白名单内、TCB 不低于下限、报告未过期、随带 collateral 新鲜
 *     （`createHardwareAttestationVerifier`——装配不出「只验 quote 不看材料时效」的校验器）。
 *
 * 背书由校验方自持的 SM2 私钥签名；平台只验这个签名，不自己验 quote（D-TEE-6）。
 *
 * **试点形态的密钥保管与释放**（design P4：沿用演练 KMS 的形状、装载真实根——换的只是校验器，
 * 不是判据）：同一进程另开两个口子——
 *  - 持有方托付：数据密钥用**本进程公钥** SM2 加密后送来，持有方签名；密钥只在进程内存，重启即失；
 *  - 节点请求释放：先把上面 ①–⑥ 对**这次会话的证明**原样再做一遍，再走协议核的
 *    `evaluateKeyRelease`（经 `LocalDevKms`），用证明里的一次性公钥封好密钥并签释放凭据。
 * 这**不是**生产 KMS：无硬件密码机、无门限共管、密钥不落盘也不备份（D-TEE-1 另行），只跑合成数据。
 */

export interface VerifierPolicy {
  /** 校验方标识（平台 `MDOP_ATTESTATION_VERIFIERS` 白名单里的那一项）。 */
  verifierId: string;
  spaceId: string;
  /** 已登记节点：participantId → SM2 公钥（部署配置）。 */
  nodeKeys: ReadonlyMap<string, string>;
  /** 允许的度量（`sm3:<64hex>`）；空 = 一律拒。 */
  measurements: readonly string[];
  /** TDX 的 TCB 下限（点分）。 */
  minTcb: string;
  /** 随带 collateral 的最大陈旧度（分钟）。 */
  collateralMaxStalenessMinutes: number;
  /** 背书有效期（分钟）；节点探针节拍必须短于它。 */
  endorsementTtlMinutes: number;
  /** 探针时间戳允许的偏差（毫秒）。 */
  clockSkewMs: number;
  /** 密钥保管方标识（写进释放凭据的 `kms`；须等于各院信封的 `wrapped_key.kms`）。 */
  kmsRef: string;
  /** 已登记的数据持有方：participantId → SM2 公钥（托付请求的签名用它验）。 */
  holderKeys: ReadonlyMap<string, string>;
}

export interface VerifierDeps {
  policy: VerifierPolicy;
  privateKey: string;
  publicKey: string;
  runSidecar: SidecarRunner;
  now?: () => Date;
}

export interface ProbeRequest {
  participantId: string;
  timestamp: string;
  signature: string;
  body: unknown;
}

export type ProbeVerdict =
  | { accepted: true; endorsement: EndorsementPush }
  | { accepted: false; detail: string };

/** 持有方托付请求体（`wrapped_dek` = 数据密钥对本进程公钥的 SM2 密文，十六进制）。 */
export interface KeyDepositRequest {
  holder: string;
  key_id: string;
  job_id: string;
  contract_id: string;
  wrapped_dek: string;
  timestamp: string;
  signature: string;
}

/** 托付请求里被签名的部分（两侧同源）。 */
export function keyDepositMessage(input: Omit<KeyDepositRequest, 'signature'>): string {
  return stableStringify({
    holder: input.holder,
    key_id: input.key_id,
    job_id: input.job_id,
    contract_id: input.contract_id,
    wrapped_dek: input.wrapped_dek,
    timestamp: input.timestamp,
  });
}

export class AttestationVerifierService {
  /** 刚被 sidecar 验过签的 quote 摘要 → 过期时刻。信任根只认在这里面的摘要。 */
  private readonly verifiedQuotes = new Map<string, number>();
  private readonly kms: LocalDevKms;

  constructor(private readonly deps: VerifierDeps) {
    this.kms = new LocalDevKms({
      kmsRef: deps.policy.kmsRef,
      privateKey: deps.privateKey,
      verifier: this.hardwareVerifier(),
      keys: new Map(),
      now: () => this.now(),
    });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** 持有方把数据密钥托付进来（先于作业执行；同一 `key_id` 不得改写归属）。 */
  depositKey(request: KeyDepositRequest): { accepted: true } | { accepted: false; detail: string } {
    try {
      const { policy } = this.deps;
      const holderKey = policy.holderKeys.get(request.holder);
      if (!holderKey) throw reject(`未登记的数据持有方：${request.holder}`);
      const ts = Number(request.timestamp);
      if (!Number.isFinite(ts) || Math.abs(this.now().getTime() - ts) > policy.clockSkewMs)
        throw reject('托付时间戳不在允许窗口内');
      const { signature, ...signed } = request;
      if (!verifySm2(keyDepositMessage(signed), signature, holderKey)) throw reject('托付签名无效');
      if (!request.key_id || !request.job_id || !request.contract_id) throw reject('托付缺归属字段');
      if (this.owners.has(request.key_id)) throw reject(`key_id 已登记，不得改写：${request.key_id}`);
      const dek = sm2Decrypt(request.wrapped_dek, this.deps.privateKey);
      if (dek.length !== 32) throw reject('数据密钥长度不是 32 字节');
      const owner = { job_id: request.job_id, contract_id: request.contract_id };
      this.owners.set(request.key_id, owner);
      this.kms.registerKey({ keyId: request.key_id, dek, owner });
      return { accepted: true };
    } catch (err) {
      if (err instanceof MdopError) return { accepted: false, detail: err.message };
      return { accepted: false, detail: '托付请求无法处理' };
    }
  }

  private readonly owners = new Map<string, { job_id: string; contract_id: string }>();

  /**
   * 节点请求释放。归属取**托付时登记的事实**，不取请求里的声明；
   * 判据是协议核的 `evaluateKeyRelease`（度量 / TCB / 链型 / 有效期 / 凭证 / 合约 / 归属），一条不过即拒。
   */
  async releaseKey(
    request: ProbeRequest,
  ): Promise<{ released: true; warrant: KeyReleaseWarrant } | { released: false; detail: string }> {
    try {
      const body = (request.body ?? {}) as { request?: Record<string, unknown>; evidence?: unknown };
      const ask = body.request ?? {};
      const { report } = await this.verifyEvidence({
        ...request,
        body: { node: (ask.report as { node?: unknown } | undefined)?.node, report: ask.report, evidence: body.evidence },
      });
      const keyId = typeof ask.key_id === 'string' ? ask.key_id : '';
      const owner = this.owners.get(keyId);
      if (!owner) throw new MdopError('E_KEY_RELEASE_DENIED', {}, `未托付的密钥：${keyId}`);
      const warrant = await this.kms.requestRelease({
        key_id: keyId,
        key_owner: owner,
        context: ask.context as { job_id: string; credential_id: string; contract_id: string },
        report,
        policy: ask.policy as AttestationPolicy,
        credential_valid: ask.credential_valid === true,
        contract_active: ask.contract_active === true,
        now: this.now(),
      });
      return { released: true, warrant };
    } catch (err) {
      if (err instanceof MdopError) return { released: false, detail: `${err.code}: ${err.message}` };
      throw err;
    }
  }

  async handleProbe(request: ProbeRequest): Promise<ProbeVerdict> {
    try {
      return { accepted: true, endorsement: await this.endorse(request) };
    } catch (err) {
      if (err instanceof MdopError) return { accepted: false, detail: err.message };
      throw err;
    }
  }

  private async endorse(request: ProbeRequest): Promise<EndorsementPush> {
    const { policy } = this.deps;
    const now = this.now();
    const { node, report, facts } = await this.verifyEvidence(request);
    return signEndorsementPush({
      verifier: policy.verifierId,
      endorsement: {
        node,
        kind: 'tdx',
        measurement: facts.measurement,
        tcb: facts.tcb,
        quoteDigest: report.quote_digest ?? '',
        verifiedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + policy.endorsementTtlMinutes * 60_000).toISOString(),
      },
      privateKey: this.deps.privateKey,
      publicKey: this.deps.publicKey,
    });
  }

  /** 判定 ①–⑥：通过后该 quote 摘要进入「已验签」集合（信任根只认它）。 */
  private async verifyEvidence(
    request: ProbeRequest,
  ): Promise<{ node: string; report: AttestationReport; facts: TdxQuoteFacts }> {
    const { policy } = this.deps;
    const now = this.now();

    // ① 探针认证
    const nodeKey = policy.nodeKeys.get(request.participantId);
    if (!nodeKey) throw reject(`未登记的节点：${request.participantId}`);
    const ts = Number(request.timestamp);
    if (!Number.isFinite(ts) || Math.abs(now.getTime() - ts) > policy.clockSkewMs)
      throw reject('探针时间戳不在允许窗口内');
    if (!verifySm2(`${request.timestamp}:${request.participantId}`, request.signature, nodeKey))
      throw reject('探针签名无效');
    const node = `urn:tds:${policy.spaceId}:participant:${request.participantId}`;

    // ② 形状与身份绑定
    const body = (request.body ?? {}) as { node?: unknown; report?: unknown; evidence?: unknown };
    const report = parseAttestationReport(body.report);
    if (body.node !== node || report.node !== node)
      throw reject('证明未绑定到发起探针的节点');
    if (report.kind !== 'tdx' || !report.quote_digest || !report.tcb)
      throw reject('本校验方只背书 TDX 硬件证明');
    const quote = (body.evidence as { quote?: unknown } | undefined)?.quote;
    if (typeof quote !== 'string' || !quote) throw reject('探针未随带原生 quote，无从验签');

    // ③ 背书的就是这份原文
    if (`sm3:${sm3Hex(quote)}` !== report.quote_digest)
      throw reject('quote 原文与报告的 quote_digest 不符');

    // ④ 验签链到 Intel 证明根
    const facts = parseQuoteFacts((await this.deps.runSidecar(['verify'], JSON.stringify({ quote_b64: quote }))).facts);

    // ⑤ 硬件覆盖核验：以原始 quote 为准
    const covered = extractTdxReportData(Buffer.from(facts.report_data, 'hex'));
    if (covered !== report.report_data) throw reject('quote 覆盖的 REPORTDATA 与报告的 report_data 不符');
    if (!report.ephemeral_public_key || covered !== reportDataBinding(report.ephemeral_public_key))
      throw reject('一次性公钥未被硬件签名覆盖');
    if (facts.measurement !== report.measurement) throw reject('报告自述的度量与 quote 不符');
    if (facts.tcb !== report.tcb) throw reject('报告自述的 TCB 与 quote 不符');

    // ⑥ 部署策略
    if (!policy.measurements.includes(facts.measurement))
      throw reject(`度量不在白名单内：${facts.measurement}`);
    const tcbOrder = compareTcb(facts.tcb, policy.minTcb);
    if (tcbOrder === null || tcbOrder < 0) throw reject(`TCB ${facts.tcb} 低于下限 ${policy.minTcb}`);
    if (Date.parse(report.expires_at) <= now.getTime()) throw reject('证明报告已过期');
    this.verifiedQuotes.set(report.quote_digest, Date.parse(report.expires_at));
    if (!this.hardwareVerifier().verify(report)) {
      this.verifiedQuotes.delete(report.quote_digest);
      throw reject('随带的校验材料（collateral）缺料或不新鲜');
    }
    return { node, report, facts };
  }

  /** 信任根只认**被 sidecar 验过签且未过期**的 quote 摘要；collateral 时效由协议核的工厂判。 */
  private hardwareVerifier(): AttestationVerifier {
    const root: TrustedRootWithCollateral = {
      kind: 'tdx',
      collateral: {
        required: ['crl', 'qvl'],
        max_staleness_minutes: this.deps.policy.collateralMaxStalenessMinutes,
      },
      verifyQuoteDigest: (digest: string, _report: AttestationReport) => {
        const until = this.verifiedQuotes.get(digest);
        if (until === undefined) return false;
        if (until <= this.now().getTime()) {
          this.verifiedQuotes.delete(digest);
          return false;
        }
        return true;
      },
    };
    return createHardwareAttestationVerifier([root], () => this.now());
  }
}

function reject(message: string): MdopError {
  return new MdopError('E_ATTESTATION_FAILED', {}, message);
}
