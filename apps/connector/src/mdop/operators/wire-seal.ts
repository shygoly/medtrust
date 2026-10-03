import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { canonicalSm3, MdopError, sm2Encrypt } from '@medtrust/mdop';
import { loadConnectorPrivateKey } from '../../domain/connector-key';
import { signSm2 } from '../../domain/sm2-sign';
import { stableStringify } from '../../domain/canonical-json';
import { MdopStageExecutor, type StageInput } from '../mdop-executor';
import { MdopContractStore } from '../contract-store';
import {
  registerSealOperator,
  type SealContractTerms,
  type SealKeyDepositor,
  type SealOperatorDeps,
} from './seal';

/**
 * 封装算子的接线（任务 6.2）：把 `seal.envelope@1.0.0` 接到执行器上。
 *
 * 三个外部依赖，任一缺失即 fail-closed（不产出信封）：
 *  - **KMS 保管口**（`CONNECTOR_MDOP_KMS_DEPOSIT_URL` 配置后才注入真实实现；未配置则拒绝）；
 *  - **本地合约副本**（证明策略与数据产品范围都从副本条款读，不采信平台消息）；
 *  - **持有方私钥**（信封的持有方签名）。
 */
/**
 * 密钥保管口的注入令牌。`SealKeyDepositor` 是接口，按类型注入在运行期解析不到——
 * 之前直接写类型导致保管口**恒为 undefined**（封装恒 fail-closed），故显式用令牌。
 */
export const SEAL_KEY_DEPOSITOR = Symbol('SEAL_KEY_DEPOSITOR');

@Injectable()
export class SealOperatorWiring implements OnModuleInit {
  private readonly logger = new Logger(SealOperatorWiring.name);

  constructor(
    private readonly executor: MdopStageExecutor,
    private readonly contracts: MdopContractStore,
    @Optional() @Inject(SEAL_KEY_DEPOSITOR) private readonly depositor?: SealKeyDepositor,
  ) {}

  onModuleInit(): void {
    registerSealOperator(
      this.executor,
      {
        kmsRef: process.env.CONNECTOR_MDOP_KMS_REF ?? 'kms://unconfigured',
        watermarkPrefix: process.env.CONNECTOR_MDOP_WATERMARK ?? 'wm:connector',
        signer: this.selfUrn(),
        sign: (content) => {
          const key = loadConnectorPrivateKey();
          if (!key) throw new Error('未配置连接器私钥：无法签署信封（D-MDOP-3）');
          return { alg: 'SM2-SM3', value: signSm2(content, key) };
        },
        depositor: this.depositor,
        randomKey: undefined,
        // 封装所需条款一律取**本地合约副本**（由节点服务在执行前读本地库注入 `contractTerms`）
        contractTermsFor: (stage: StageInput) => {
          const terms = stage.contractTerms as
            | (SealContractTerms & { credential_id?: string })
            | undefined;
          if (!terms?.contract_id || !terms.data_product_id)
            throw new MdopError('E_ENVELOPE_POLICY', {}, '封装算子缺本地合约条款，拒绝封装');
          return terms;
        },
      },
      this.logger,
    );
    this.logger.log(`封装算子已注册：${this.executor.registeredSystemOps().join(', ')}`);
  }

  private selfUrn(): string {
    return `urn:tds:${process.env.SPACE_ID ?? 'sh-med'}:participant:${
      process.env.CONNECTOR_PARTICIPANT_ID ?? ''
    }`;
  }
}

/**
 * 开发用的本地保管口：把 DEK 记在内存里（**仅用于本机演练**）。
 * 生产必须换成医院自建 KMS 或共管 KMS 的客户端——信封里的 `key_id` 是它的引用。
 */
@Injectable()
export class InMemorySealKeyDepositor implements SealKeyDepositor {
  private readonly keys = new Map<string, string>();
  private readonly logger = new Logger(InMemorySealKeyDepositor.name);

  async depositKey(input: { jobId: string; keyId: string; dek: Buffer }): Promise<void> {
    // 只存摘要：本类不保留密钥本体也能证明「接口形状够用」；真实 KMS 才持有可释放的密钥。
    this.keys.set(input.keyId, canonicalSm3(input.dek.toString('base64')));
    this.logger.warn(
      `本地保管口收到 DEK（演练用）：job=${input.jobId} key=${input.keyId}（不可用于生产）`,
    );
  }

  has(keyId: string): boolean {
    return this.keys.has(keyId);
  }
}

/**
 * 远程保管口：把数据密钥托付给合约指定的密钥保管方（`CONNECTOR_MDOP_KMS_DEPOSIT_URL`）。
 *
 * 密钥**不以明文过网**：用保管方公钥（`CONNECTOR_MDOP_KMS_PUBKEY`，部署配置）做 SM2 加密；
 * 请求由持有方私钥签名，保管方据登记的持有方公钥验——归属（作业 / 合约）在托付时就钉死，
 * 释放时以这份登记为准，不听请求方声明。保管方没明确接受即抛错：封装算子随之 fail-closed，
 * 不会出现「信封发出去了、密钥没人保管」。
 */
export class HttpSealKeyDepositor implements SealKeyDepositor {
  constructor(
    private readonly opts: {
      url: string;
      kmsPublicKey: string;
      holder: string;
      privateKey: () => string | null;
      fetchImpl?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  async depositKey(input: {
    jobId: string;
    keyId: string;
    dek: Buffer;
    contractId: string;
  }): Promise<void> {
    const key = this.opts.privateKey();
    if (!key) throw new MdopError('E_ENVELOPE_POLICY', {}, '未配置连接器私钥：无法签署密钥托付');
    if (!this.opts.kmsPublicKey)
      throw new MdopError('E_ENVELOPE_POLICY', {}, '未配置保管方公钥（CONNECTOR_MDOP_KMS_PUBKEY）：密钥不得明文托付');
    const signed = {
      holder: this.opts.holder,
      key_id: input.keyId,
      job_id: input.jobId,
      contract_id: input.contractId,
      wrapped_dek: sm2Encrypt(input.dek, this.opts.kmsPublicKey),
      timestamp: String((this.opts.now?.() ?? new Date()).getTime()),
    };
    const res = await (this.opts.fetchImpl ?? fetch)(this.opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...signed, signature: signSm2(stableStringify(signed), key) }),
    });
    const body = res.ok ? ((await res.json()) as { accepted?: unknown; detail?: unknown }) : null;
    if (body?.accepted !== true)
      throw new MdopError(
        'E_ENVELOPE_POLICY',
        {},
        `密钥保管方未接受托付（${res.ok ? String(body?.detail ?? '未说明') : `HTTP ${res.status}`}），拒绝封装`,
      );
  }
}

/** 由部署配置选保管口：配了托付地址用远程保管方，否则退回本地演练口（只留摘要）。 */
export function sealKeyDepositorFromEnv(): SealKeyDepositor {
  const url = (process.env.CONNECTOR_MDOP_KMS_DEPOSIT_URL ?? '').trim();
  if (!url) return new InMemorySealKeyDepositor();
  return new HttpSealKeyDepositor({
    url,
    kmsPublicKey: (process.env.CONNECTOR_MDOP_KMS_PUBKEY ?? '').trim(),
    holder: (process.env.CONNECTOR_PARTICIPANT_ID ?? '').trim(),
    privateKey: () => loadConnectorPrivateKey(),
  });
}

/** 供测试与调用方复用：由本地合约副本条款构造封装所需字段。 */
export async function sealTermsFromLocalCopy(
  contracts: MdopContractStore,
  contractId: string,
  credentialId: string,
): Promise<SealContractTerms & { credential_id: string }> {
  const row = await contracts.get(contractId);
  if (!row) throw new Error(`本地没有该合约副本，无法封装：${contractId}`);
  const terms = JSON.parse(row.canonical) as {
    contract_id: string;
    data_product_id: string;
    allowed_ops?: string[];
    attestation_policy?: SealContractTerms['attestation_policy'];
    valid_until?: string;
  };
  return { ...terms, credential_id: credentialId };
}
