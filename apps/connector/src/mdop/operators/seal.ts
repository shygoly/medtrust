import { Logger } from '@nestjs/common';
import { createCipheriv, randomBytes } from 'crypto';
import {
  DATA_ENVELOPE_VERSION,
  MdopError,
  canonicalSm3,
  canonicalize,
  parseDataEnvelope,
  sm3Hex,
  type AttestationPolicy,
  type DataEnvelope,
} from '@medtrust/mdop';
import type { MdopStageExecutor, StageInput } from '../mdop-executor';

/**
 * 封装算子 `seal.envelope@1.0.0`（任务 6.2、协议 §4.2 R4 / §9.3）。
 *
 * C2 的**唯一来源**：把本节点已去标识的投影封成 `mdop.env/1.0` 信封。
 * 三条硬要求：
 *  ① 只封**合约声明的那一份数据产品切片**（送错数据源等于越权）；
 *  ② 合约必须声明证明策略（否则该合约不允许 C2）；
 *  ③ 数据密钥交给**配置内的 KMS 保管**后才产出信封——没有 KMS 就 fail-closed，
 *     绝不「先出信封、密钥稍后补」，那等于把明文交出去只锁了空箱子。
 *
 * 加密：AEAD（本期 AES-256-GCM；`cipher` 字段如实写明）。选 SM4-GCM 只需替换
 * `aeadSeal` 的实现——信封的 AAD 绑定、密钥保管与策略字段都不动。
 */

export const SEAL_OP = 'seal.envelope@1.0.0';

export interface SealKeyDepositor {
  /**
   * 把一次性数据密钥交给 KMS 保管（返回的 `key_id` 写进信封）。
   * 实现可以是「医院自建 KMS」「与运营方共管」或开发用的本地保管；**缺省即拒**。
   */
  depositKey(input: {
    jobId: string;
    keyId: string;
    dek: Buffer;
    contractId: string;
  }): Promise<void>;
}

export interface SealOperatorDeps {
  /** KMS 标识（写进 `wrapped_key.kms`）。 */
  kmsRef: string;
  /** 水印前缀（站点/空间标识，如 `wm:site-a:sh-med`）。 */
  watermarkPrefix: string;
  /** 持有方节点标识（写进 `origin_sig.signer`）。 */
  signer: string;
  /** 持有方签名：对**去掉 origin_sig 的信封**的规范化串签名（SM2）。 */
  sign(content: string): { alg: string; value: string };
  /** 数据密钥保管；缺省即拒（fail-closed）。 */
  depositor?: SealKeyDepositor;
  now?: () => Date;
  randomKey?: () => Buffer;
}

/** 合约里与封装相关的字段（读自**本地副本的条款**）。 */
export interface SealContractTerms {
  contract_id: string;
  data_product_id: string;
  allowed_ops?: string[];
  attestation_policy?: AttestationPolicy;
  valid_until?: string;
}

export interface SealedArtifact {
  envelope: DataEnvelope;
  /** 密文本体（本地制品库保存；出节点时随信封一起走数据面）。 */
  ciphertext: string;
  iv: string;
  tag: string;
}

/** AEAD 封装：AAD = 规范化后的绑定信息（换作业/换凭证/换合约即解不开）。 */
function aeadSeal(
  dek: Buffer,
  plaintext: unknown,
  aad: { job_id: string; credential_id: string; contract_id: string },
): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(canonicalize(aad), 'utf8'));
  const ct = Buffer.concat([cipher.update(Buffer.from(canonicalize(plaintext), 'utf8')), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export interface SealBuildInput {
  jobId: string;
  credentialId: string;
  contract: SealContractTerms;
  /** 待封装的本地投影（已去标识）。 */
  projection: Record<string, unknown>;
  /** 投影所属的数据产品 id（必须与合约声明一致）。 */
  dataProductId: string;
  /** 允许的算子摘要（写进信封策略）。 */
  allowedOps: string[];
}

export async function buildSealedEnvelope(
  input: SealBuildInput,
  deps: SealOperatorDeps,
): Promise<SealedArtifact> {
  const policy = input.contract.attestation_policy;
  if (!policy)
    throw new MdopError('E_ENVELOPE_POLICY', {}, '本地合约未声明证明策略，不允许封装 C2 数据');
  if (input.contract.data_product_id !== input.dataProductId)
    throw new MdopError(
      'E_ENVELOPE_POLICY',
      {},
      `数据产品 ${input.dataProductId} 不在合约声明范围内（合约声明 ${input.contract.data_product_id}）`,
    );
  if (!deps.depositor)
    throw new MdopError('E_KEY_RELEASE_DENIED', {}, '未接入数据密钥保管（KMS），拒绝产出信封');

  const now = (deps.now ?? (() => new Date()))();
  const dek = (deps.randomKey ?? (() => randomBytes(32)))();
  const keyId = `k-${canonicalSm3(keyIdSeed(input, deps.signer, now)).replace(/^sm3:/, '').slice(0, 16)}`;
  await deps.depositor.depositKey({
    jobId: input.jobId,
    keyId,
    dek,
    contractId: input.contract.contract_id,
  });

  const aad = {
    job_id: input.jobId,
    credential_id: input.credentialId,
    contract_id: input.contract.contract_id,
  };
  const sealed = aeadSeal(dek, input.projection, aad);

  // 被签的是**整封信封去掉 `origin_sig`**——`aad` 也在里面。
  // 早期版本漏签了 `aad`：AEAD 仍能挡住解密（AAD 不符即认证失败），但信封「声明的绑定」
  // 就成了未被签名的字段，与「信封自带内容都经持有方签名」的语义不符。
  const envelopeForSigning = {
    envelope: DATA_ENVELOPE_VERSION,
    payload: {
      cipher: 'AES-256-GCM',
      ciphertext_ref: `blob://sealed/${keyId}`,
      // 密文摘要 = **密文字节的** SM3（不是 base64 文本的摘要）。节点解封前用它对拍完整性。
      digest: `sm3:${sm3Hex(Buffer.from(sealed.ciphertext, 'base64'))}`,
    },
    wrapped_key: { kms: deps.kmsRef, key_id: keyId },
    policy: {
      contract: input.contract.contract_id,
      purpose: [],
      allowed_ops: [...input.allowedOps],
      attestation_policy: policy,
      export: 'C3_only' as const,
      not_after: input.contract.valid_until ?? new Date(now.getTime() + 86_400_000).toISOString(),
    },
    watermark: `${deps.watermarkPrefix}:${now.toISOString().slice(0, 10).replace(/-/g, '')}`,
    aad,
  };
  const envelope = {
    ...envelopeForSigning,
    origin_sig: { signer: deps.signer, ...deps.sign(canonicalize(envelopeForSigning)) },
  };
  // 自检：形状不合规就不产出（不留半份信封）
  const parsed = parseDataEnvelope(envelope);
  return { envelope: parsed, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag };
}

/**
 * `key_id` 的派生种子。**必须带持有方身份**：一份作业里同一数据产品被两家持有方各封一份时，
 * 只用「作业 + 合约 + 产品 + 时间」会在同一毫秒内撞成**同一个 `key_id`**——
 * 于是 KMS 侧两条密钥记录被当成一条，一方释放就等于「替另一方释放」。带上 `holder` 后，
 * 同一时刻两家的 `key_id` 必然不同（有用例钉住）。
 */
function keyIdSeed(input: SealBuildInput, holder: string, now: Date): Record<string, unknown> {
  return {
    job: input.jobId,
    contract: input.contract.contract_id,
    product: input.dataProductId,
    holder,
    at: now.toISOString(),
  };
}

/**
 * 封存前的**最小投影**：出院的密文里只带跨院配对用得到的五个字段。
 *
 * 上游 `source.dataset` 给的是整份院内记录（诊断、用药、不良事件、检验…）。节点内配对只读
 * `subjectKey / exposure / outcome / ageBand / sex`，其余字段一个都不该进信封——
 * 「进入可信空间节点的必须是最小投影」（DEPLOY §4.3 如实边界：TEE 不防侧信道）。
 *
 *  - 配对键只认**跨院关联假名** `linkKey`：院内假名 `subjectKey` 各院互不相同，拿它配对交集恒为空；
 *    没有 `linkKey` 的记录**不出院**（它们本来也配不上）。
 *  - `exposure` / `outcome` 取自院内记录的 `treated` / `eventOccurred`（已是布尔的直接沿用）。
 */
export function minimalPairingProjection(upstream: Record<string, unknown>): Record<string, unknown> {
  const rows = Array.isArray(upstream.rows) ? (upstream.rows as Array<Record<string, unknown>>) : [];
  const projected = rows
    .filter((row) => typeof row.linkKey === 'string' && row.linkKey)
    .map((row) => ({
      subjectKey: row.linkKey as string,
      exposure: (row.exposure ?? row.treated) === true,
      outcome: (row.outcome ?? row.eventOccurred) === true,
      ...(typeof row.ageBand === 'string' ? { ageBand: row.ageBand } : {}),
      ...(typeof row.sex === 'string' ? { sex: row.sex } : {}),
    }));
  return {
    productId: upstream.productId,
    snapshot: upstream.snapshot,
    n: projected.length,
    rows: projected,
  };
}

/**
 * 疫苗接种后不良事件监测（SCRI）的两种最小投影，一行一剂 / 一行一次事件：
 *  - 接种侧（疾控）：`{subjectKey: linkKey, vaccinationDate, vaccineCode, ageBand, sex}`；
 *  - 事件侧（医院）：`{subjectKey: linkKey, eventDate, eventCode}`。
 * 同样只认跨院关联假名；没有 `linkKey` 的记录不出院；只封阶段参数里点名的疫苗 / 诊断编码。
 */
export function scriRegistryProjection(
  upstream: Record<string, unknown>,
  vaccineCodes?: readonly string[],
): Record<string, unknown> {
  const wanted = new Set(vaccineCodes ?? []);
  const rows = Array.isArray(upstream.rows) ? (upstream.rows as Array<Record<string, unknown>>) : [];
  const projected = rows
    .filter((row) => typeof row.linkKey === 'string' && row.linkKey && Array.isArray(row.immunizations))
    .flatMap((row) =>
      (row.immunizations as Array<{ code?: unknown; date?: unknown }>)
        .filter((dose) => wanted.size === 0 || wanted.has(String(dose.code ?? '')))
        .map((dose) => ({
        subjectKey: row.linkKey as string,
        vaccinationDate: String(dose.date ?? ''),
        vaccineCode: String(dose.code ?? ''),
        ...(typeof row.ageBand === 'string' ? { ageBand: row.ageBand } : {}),
        ...(typeof row.sex === 'string' ? { sex: row.sex } : {}),
      })),
    );
  return { productId: upstream.productId, snapshot: upstream.snapshot, n: projected.length, rows: projected };
}

export function scriEventProjection(
  upstream: Record<string, unknown>,
  eventCodes?: readonly string[],
): Record<string, unknown> {
  const wanted = new Set(eventCodes ?? []);
  const rows = Array.isArray(upstream.rows) ? (upstream.rows as Array<Record<string, unknown>>) : [];
  const projected = rows
    .filter((row) => typeof row.linkKey === 'string' && row.linkKey && Array.isArray(row.datedEvents))
    .flatMap((row) =>
      (row.datedEvents as Array<{ code?: unknown; date?: unknown }>)
        .filter((event) => wanted.size === 0 || wanted.has(String(event.code ?? '')))
        .map((event) => ({
        subjectKey: row.linkKey as string,
        eventDate: String(event.date ?? ''),
        eventCode: String(event.code ?? ''),
      })),
    );
  return { productId: upstream.productId, snapshot: upstream.snapshot, n: projected.length, rows: projected };
}

/** 按阶段参数 `projection` 选投影；缺省 = 跨院配对（既有作业形状不变）。未知取值即拒。 */
function projectionFor(
  params: Record<string, unknown> | undefined,
  upstream: Record<string, unknown>,
): Record<string, unknown> {
  const kind = params?.projection;
  const codes = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
  if (kind === undefined || kind === 'pairing') return minimalPairingProjection(upstream);
  if (kind === 'scri-registry') return scriRegistryProjection(upstream, codes(params?.vaccineCodes));
  if (kind === 'scri-events') return scriEventProjection(upstream, codes(params?.eventCodes));
  throw new MdopError('E_ENVELOPE_POLICY', {}, `未知的封存投影：${String(kind)}（拒绝封装）`);
}

/**
 * 把封装算子接到执行器上。输入是**本节点内的上游 C0 制品**（同节点，不跨消息），
 * 输出 C2 信封；投影本身仍留本地，出节点的是密文。
 */
export function registerSealOperator(
  executor: MdopStageExecutor,
  deps: SealOperatorDeps & {
    /** 从合约条款里取封装所需字段（本地副本）。 */
    contractTermsFor(stage: StageInput): SealContractTerms;
  },
  logger: Logger = new Logger('SealOperator'),
): void {
  executor.registerSystem(SEAL_OP, async (input) => {
    const upstream = [...input.inputs.values()][0] as
      | { rows?: unknown[]; productId?: string }
      | undefined;
    if (!upstream) throw new MdopError('E_RUNTIME', {}, '封装算子缺上游 C0 制品');
    const terms = deps.contractTermsFor(input);
    const sealed = await buildSealedEnvelope(
      {
        jobId: input.jobId,
        credentialId: String((input.contractTerms as { credential_id?: string })?.credential_id ?? ''),
        contract: terms,
        projection: projectionFor(input.stage.params as Record<string, unknown> | undefined, upstream as Record<string, unknown>),
        dataProductId: String(upstream.productId ?? ''),
        allowedOps: terms.allowed_ops ?? [],
      },
      deps,
    );
    logger.log(`封装完成 job=${input.jobId} key=${sealed.envelope.wrapped_key.key_id}`);
    // 载荷只放信封 + 密文（不含明文投影）
    return {
      label: 'C2' as const,
      schema: 'mdop.env/1.0',
      payload: {
        envelope: sealed.envelope as unknown as Record<string, unknown>,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        tag: sealed.tag,
      },
    };
  });
}
