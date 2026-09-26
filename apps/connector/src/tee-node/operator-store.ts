import {
  assertMonotonicVersion,
  parseOperatorManifest,
  parseRevocationList,
  verifyRevocationList,
  type OperatorManifest,
  type OperatorRevocationList,
} from '@medtrust/mdop';
import { verifyObjectWithKid } from '../mdop/verify-manifest';

/**
 * 节点侧的**算子清单 / 吊销 / 模块库**（任务 3.12g）。
 *
 * 为什么必须有：节点复核要判「这个算子在不在本地清单、有没有被吊销、我能不能跑」，
 * 而节点组件此前既没有清单来源，也没有模块字节来源——真实部署下**每一个阶段都会以
 * `E_OP_NOT_WHITELISTED` 被拒**（或执行时找不到模块字节），链一步也走不动。
 *
 * 三条口径与数据持有方连接器**刻意一致**（`mdop/operator-whitelist.ts`），但持久化方式不同：
 *
 * | 项 | 来源 | 验签公钥（部署配置） | 缺省行为 |
 * |---|---|---|---|
 * | 算子清单 | 平台随长轮询下发（`mdopOperators`） | 注册中心公钥 | 没有清单 = 未加白（拒） |
 * | 吊销名单 | 平台随长轮询下发（`mdopRevocations`） | 平台节点公钥 | **未同步到有效名单 = 拒绝执行 wasm** |
 * | 模块字节 | **节点本地模块库**（运维按摘要放置） | —（本地放置即是准入决定） | 没有字节 = 拒（不现取平台） |
 *
 * 关于「白名单」：连接器有「医院本地按摘要加白」的独立动作；节点这边**模块字节存在与否本身
 * 就是本地准入决定**（运维把模块放进节点才可能有字节），因此不再另设一份可被平台写入的白名单——
 * 平台消息能做的只有「提供清单」与「吊销」，不能给节点凭空加一个它能跑的算子。
 *
 * 清单与吊销名单都是**每轮长轮询刷新**（平台每次都带），因此这里只放内存：
 * 进程重启后到下一次轮询之间按「没有有效清单」处理（fail-closed），不需要落盘。
 */

export class NodeOperatorNotAllowedError extends Error {
  constructor(
    readonly code: 'E_OP_NOT_WHITELISTED' | 'E_OP_REVOKED' | 'E_REVOCATION_UNSYNCED',
    message: string,
  ) {
    super(message);
    this.name = 'NodeOperatorNotAllowedError';
  }
}

export interface NodeOperatorStoreDeps {
  /** 注册中心公钥（部署配置；核验算子清单签名）。 */
  registryPublicKey: string;
  /** 平台节点公钥（部署配置；核验吊销名单签名）。 */
  platformPublicKey: string;
  /** 本地模块库：按摘要（裸 hex 或 `sm3:<hex>`）取字节；没有即拒。 */
  moduleBytes?(digest: string): Uint8Array | undefined;
  logger?: { warn(message: string): void; log?(message: string): void };
}

/** 长轮询批次里的清单条目（与平台 `ConnectorTaskBatch` 同形状）。 */
export interface OperatorManifestEntry {
  ref: string;
  digest: string;
  manifest: unknown;
  signature: unknown;
}

const normalize = (digest: string): string => digest.replace(/^sm3:/i, '').toLowerCase();

export class NodeOperatorStore {
  private readonly manifests = new Map<string, OperatorManifest>();
  /** 已验签采纳的清单引用（按 ref），用于回答「我有没有这份清单」。 */
  private revocations: OperatorRevocationList | null = null;
  private revoked = new Set<string>();

  constructor(private readonly deps: NodeOperatorStoreDeps) {}

  /**
   * 收下并验算子清单。**只更新清单**：签名不对或结构非法的整条丢弃（fail-closed），
   * 返回采纳条数。用错密钥的清单一律拒（`kid` 必须等于部署配置的注册中心公钥）。
   */
  applyManifests(payload: readonly OperatorManifestEntry[] | undefined): number {
    if (!payload?.length) return 0;
    if (!this.deps.registryPublicKey) {
      this.deps.logger?.warn('未配置注册中心公钥：算子清单全部拒绝（fail-closed）');
      return 0;
    }
    let accepted = 0;
    for (const item of payload) {
      try {
        const manifest = parseOperatorManifest(item.manifest);
        if (!verifyObjectWithKid(manifest, item.signature, this.deps.registryPublicKey)) {
          this.deps.logger?.warn(`算子清单验签失败，已丢弃：${item.ref}`);
          continue;
        }
        // 清单自带摘要必须与条目声明一致，否则「换摘要」就能把别的字节挂到这份清单上
        if (manifest.kind === 'wasm' && normalize(manifest.digest) !== normalize(item.digest)) {
          this.deps.logger?.warn(`算子清单摘要与条目不符，已丢弃：${item.ref}`);
          continue;
        }
        this.manifests.set(item.ref, manifest);
        accepted += 1;
      } catch (err) {
        this.deps.logger?.warn(`算子清单非法，已丢弃 ${item.ref}：${(err as Error).message}`);
      }
    }
    return accepted;
  }

  /**
   * 收下并验吊销名单：平台节点密钥验签 + **版本单调**（回退一律拒）。
   * 采纳前不动本地状态，因此坏名单不会把节点变成「没有名单」。
   */
  applyRevocations(list: unknown): boolean {
    if (!list) return false;
    if (!this.deps.platformPublicKey) {
      this.deps.logger?.warn('未配置平台节点公钥：吊销名单拒收（fail-closed）');
      return false;
    }
    let parsed: OperatorRevocationList;
    try {
      parsed = parseRevocationList(list);
    } catch (err) {
      this.deps.logger?.warn(`吊销名单结构非法，拒收：${(err as Error).message}`);
      return false;
    }
    if (!verifyRevocationList(parsed, this.deps.platformPublicKey)) {
      this.deps.logger?.warn('吊销名单验签失败，拒收');
      return false;
    }
    try {
      assertMonotonicVersion(parsed, this.revocations);
    } catch (err) {
      this.deps.logger?.warn(`吊销名单版本检查未通过：${(err as Error).message}`);
      return false;
    }
    this.revocations = parsed;
    this.revoked = new Set(parsed.revoked_digests.map(normalize));
    this.deps.logger?.log?.(
      `吊销名单已更新 version=${parsed.version}（${parsed.revoked_digests.length} 条）`,
    );
    return true;
  }

  /** 已验收的清单（复核用）。 */
  manifestFor(ref: string): OperatorManifest | undefined {
    return this.manifests.get(ref);
  }

  manifestCount(): number {
    return this.manifests.size;
  }

  hasValidRevocations(): boolean {
    return this.revocations !== null;
  }

  /**
   * 执行前闸门（复核与执行都走它）：
   *  - `system`：清单已验签 + 本节点实现里有它（后者由 `assertNodeCanRun` 与执行器登记保证）；
   *  - `wasm`：额外要求「已同步有效吊销名单」且**未被吊销**，以及**本地模块库里有这个摘要的字节**。
   */
  assertExecutable(input: { op: string; digest: string; kind: 'wasm' | 'system' }): void {
    const manifest = this.manifests.get(input.op);
    if (!manifest)
      throw new NodeOperatorNotAllowedError(
        'E_OP_NOT_WHITELISTED',
        `算子清单未同步：${input.op}`,
      );
    if (input.kind !== 'wasm') return;

    const digest = normalize(input.digest);
    if (this.revocations === null)
      throw new NodeOperatorNotAllowedError(
        'E_REVOCATION_UNSYNCED',
        '尚未同步到有效的算子吊销名单：拒绝执行 wasm 算子（fail-closed）',
      );
    if (this.revoked.has(digest))
      throw new NodeOperatorNotAllowedError('E_OP_REVOKED', `算子 ${digest} 已被吊销`);
    if (!this.deps.moduleBytes?.(digest))
      throw new NodeOperatorNotAllowedError(
        'E_OP_NOT_WHITELISTED',
        `本节点模块库里没有该摘要的字节：${digest}（本地放置才可能执行）`,
      );
  }

  /** 本地模块库取字节（执行接线用；`sm3:` 前缀可有可无）。 */
  moduleBytes(digest: string): Uint8Array | undefined {
    return this.deps.moduleBytes?.(normalize(digest));
  }
}

/**
 * 节点运行时的配置（逐个键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。
 *
 * **注册中心公钥必须来自部署配置**：它决定「谁的清单算数」，MUST NOT 取自消息
 * （否则控制面被攻破就能连清单签名一起换）。缺它就一条清单都不采纳（fail-closed）。
 */
export function nodeOperatorEnv(): { registryPublicKey: string } {
  return {
    registryPublicKey: (process.env.TEE_NODE_REGISTRY_PUBKEY ?? '').trim(),
  };
}
