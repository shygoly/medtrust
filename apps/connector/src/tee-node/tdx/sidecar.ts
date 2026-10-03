import { execFile } from 'node:child_process';
import {
  MdopError,
  sm2Decrypt,
  type AttestationCollateral,
  type KeyReleaseWarrant,
} from '@medtrust/mdop';
import type { TeeNodeConfig } from '../config';
import { loadNodeIdentity } from '../identity';
import { HttpKmsClient } from '../remote-kms';
import type { TeeNodeProviderRegistry } from '../providers';
import { TdxAttestationProvider } from './provider';
import type { TdxQuoteRequest, TdxQuoteResult, TdxQuoteSource } from './quote-source';

/**
 * `tdx-sidecar`（Go，`apps/connector/tools/tdx-sidecar`）的子进程封装——
 * quote source 端口的真机实现（tdx-attestation-pilot 任务 2.2 / 2.4 / 4.1）。
 *
 * 节点侧（`quote`）与校验方（`verify`）共用同一个二进制与同一份度量 / TCB 口径：
 *   measurement = `sm3:` + SM3(MR_TD 原始字节)；tcb = TEE_TCB_SVN 前三字节点分。
 * 口径由 sidecar 从**原始 quote** 解析得出，TS 侧不重算、不手填。
 */

/** sidecar 从原始 quote 解析出的事实（两条子命令同形）。 */
export interface TdxQuoteFacts {
  /** quote 覆盖的 REPORTDATA，128 位十六进制。 */
  report_data: string;
  mr_td: string;
  /** `sm3:<64hex>`。 */
  measurement: string;
  tee_tcb_svn: string;
  /** 点分数字。 */
  tcb: string;
}

export type SidecarRunner = (
  args: readonly string[],
  stdin?: string,
) => Promise<Record<string, unknown>>;

/**
 * 运行 sidecar 并解析它的单行 JSON。非零退出、输出不是 JSON、`ok !== true` 一律
 * `E_ATTESTATION_FAILED`（fail-closed）；错误信息取 sidecar 自己给的 `error`。
 */
export function tdxSidecarRunner(sidecarPath: string, timeoutMs = 30_000): SidecarRunner {
  return (args, stdin) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        sidecarPath,
        [...args],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(stdout) as Record<string, unknown>;
          } catch {
            parsed = null;
          }
          if (parsed?.ok === true) return resolve(parsed);
          const reason =
            typeof parsed?.error === 'string'
              ? parsed.error
              : (err?.message ?? 'sidecar 输出不是 JSON');
          reject(new MdopError('E_ATTESTATION_FAILED', {}, `tdx-sidecar ${args[0]} 失败：${reason}`));
        },
      );
      if (stdin !== undefined) child.stdin?.end(stdin);
    });
}

export function parseQuoteFacts(raw: unknown): TdxQuoteFacts {
  const f = (raw ?? {}) as Record<string, unknown>;
  for (const key of ['report_data', 'mr_td', 'measurement', 'tee_tcb_svn', 'tcb'] as const) {
    if (typeof f[key] !== 'string' || !f[key])
      throw new MdopError('E_ATTESTATION_FAILED', {}, `tdx-sidecar 结果缺字段 facts.${key}`);
  }
  return f as unknown as TdxQuoteFacts;
}

/** 经 sidecar 取真实 quote 的 quote source（跑在 TDVM 内）。 */
export class ExecTdxQuoteSource implements TdxQuoteSource {
  constructor(private readonly run: SidecarRunner) {}

  async requestQuote(request: TdxQuoteRequest): Promise<TdxQuoteResult> {
    const out = await this.run([
      'quote',
      '-report-data',
      Buffer.from(request.reportData).toString('hex'),
    ]);
    const facts = parseQuoteFacts(out.facts);
    if (typeof out.quote_b64 !== 'string' || !out.quote_b64)
      throw new MdopError('E_ATTESTATION_FAILED', {}, 'tdx-sidecar 未给出 quote 原文');
    return {
      quoteBase64: out.quote_b64,
      mrtd: facts.measurement,
      tcb: facts.tcb,
      collateral: (out.collateral ?? []) as AttestationCollateral[],
    };
  }
}

/** 真机装配：两处接缝的实现 + 飞地内解封（三者共用同一个证明提供者实例）。 */
export interface TdxNodeWiring {
  providers: TeeNodeProviderRegistry;
  /** 用释放凭据指向的那把一次性私钥解开数据密钥；未接线时为 `undefined`（沿用装配缺省）。 */
  unwrapKey?: (warrant: KeyReleaseWarrant) => Uint8Array;
}

/**
 * 由部署配置装出真机实现（任务 4.1）：
 *  - `TEE_NODE_TDX_SIDECAR` → 证明提供者（未配置即空 registry：`hardware` 模式照旧抛「未接入真实证明代理」）；
 *  - `TEE_NODE_KMS_URL` → 远程 KMS 客户端（未配置则 `remote` 模式照旧抛「未接入真实 KMS 客户端」）。
 * 证明提供者只造一个实例：KMS 客户端要向保管方出示**同一次证明**的 quote，解封要用**同一把**一次性私钥。
 */
export function tdxWiringFromEnv(): TdxNodeWiring {
  const sidecarPath = (process.env.TEE_NODE_TDX_SIDECAR ?? '').trim();
  if (!sidecarPath) return { providers: {} };
  const kmsUrl = (process.env.TEE_NODE_KMS_URL ?? '').trim();

  let provider: TdxAttestationProvider | null = null;
  const providerFor = (config: TeeNodeConfig): TdxAttestationProvider =>
    (provider ??= new TdxAttestationProvider({
      node: config.urn,
      quoteSource: new ExecTdxQuoteSource(tdxSidecarRunner(sidecarPath)),
    }));

  return {
    providers: {
      hardwareAttestation: providerFor,
      ...(kmsUrl
        ? {
            remoteKms: (config: TeeNodeConfig) =>
              new HttpKmsClient({
                kmsRef: config.kmsRef,
                url: kmsUrl,
                participantId: config.participantId,
                privateKey: loadNodeIdentity({
                  participantId: config.participantId,
                  keyFile: config.keyFile,
                  spaceId: config.spaceId,
                }).privateKey,
                evidence: providerFor(config),
              }),
          }
        : {}),
    },
    unwrapKey: (warrant) => {
      const key = provider?.ephemeralPrivateKeyFor(warrant.ephemeral_key_digest);
      if (!key)
        throw new MdopError(
          'E_KEY_RELEASE_DENIED',
          {},
          '释放凭据封给的一次性公钥不属于本实例近期的证明，无法解封',
        );
      if (warrant.wrapped_key_encoding !== 'hex')
        throw new MdopError('E_KEY_RELEASE_DENIED', {}, '只支持 hex 封装的数据密钥');
      return sm2Decrypt(warrant.wrapped_key, key);
    },
  };
}

/** 只取 registry（`advertise` / `heartbeat` / `probe` 用不到解封）。 */
export function tdxRegistryFromEnv(): TeeNodeProviderRegistry {
  return tdxWiringFromEnv().providers;
}
