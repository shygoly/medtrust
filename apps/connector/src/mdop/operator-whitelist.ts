import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LocalMdopOperatorWhitelist,
  LocalMdopRevocationState,
} from '@medtrust/database';
import {
  assertMonotonicVersion,
  parseOperatorManifest,
  parseRevocationList,
  verifyRevocationList,
  type FlowLabel,
  type OperatorManifest,
  type OperatorRevocationList,
} from '@medtrust/mdop';
import { platformPublicKey } from '../domain/platform-keys';
import { verifyObjectWithKid } from './verify-manifest';

/**
 * 连接器本地算子白名单 + 吊销名单状态（D-MDOP-5 / 任务 6.3、6.4）。
 *
 * 三条硬规矩：
 *  ① **白名单缺省为空**，只能由医院在本地加/减；代码里没有任何从平台消息写入白名单的路径
 *     （`applyOperatorManifests` 只更新清单，不碰白名单）。
 *  ② 复核对清单的签名用**部署固定的注册中心公钥**验；用错密钥的清单一律拒。
 *  ③ 吊销名单由平台节点密钥签、版本单调、落盘；**启动后在收到并验过一份有效名单之前，
 *     拒绝执行任何 wasm 算子**（重启后不失效）。
 */

export interface WhitelistEntry {
  digest: string;
  kind: 'wasm' | 'system';
  addedBy: string;
  note?: string | null;
}

export class OperatorNotAllowedError extends Error {
  constructor(
    readonly code: 'E_OP_NOT_WHITELISTED' | 'E_OP_REVOKED' | 'E_REVOCATION_UNSYNCED',
    message: string,
  ) {
    super(message);
    this.name = 'OperatorNotAllowedError';
  }
}

/** 能力通告内容（任务 6.5）——编译器据此决定能不能把阶段放在本节点。 */
export interface CapabilityAdvertise extends Record<string, unknown> {
  runtime: string[];
  system_ops: string[];
  whitelist_digests: string[];
  /** 本期恒为 null（无硬件 TEE，D-MDOP-6）。 */
  tee: { kind: string; min_tcb?: string } | null;
  /** 本期恒为空（无协同协议）。 */
  protocols: Array<{ name: string; version: string }>;
}

export interface OperatorWhitelistDeps {
  /**
   * 测试/特殊部署用：按**用途**覆盖平台公钥来源。
   * 注意必须分用途 —— 吊销名单用平台节点密钥，算子清单用注册中心密钥；
   * 一把公钥覆盖两处会让「按用途验签」形同虚设。
   */
  platformPublicKeyOverrides?: Partial<Record<'platform-node' | 'registry', string>>;
}

@Injectable()
export class MdopOperatorWhitelistStore {
  private readonly logger = new Logger(MdopOperatorWhitelistStore.name);
  /** 已验签的算子清单（内存态，随批次刷新）。 */
  private manifests = new Map<string, OperatorManifest>();

  constructor(
    @InjectRepository(LocalMdopOperatorWhitelist)
    private readonly whitelist: Repository<LocalMdopOperatorWhitelist>,
    @InjectRepository(LocalMdopRevocationState)
    private readonly revocationState: Repository<LocalMdopRevocationState>,
    @Optional() @Inject('MDOP_OPERATOR_WHITELIST_DEPS')
    private readonly deps: OperatorWhitelistDeps = {},
  ) {}

  // ── 白名单（只由本地 CLI / 院内端点调用）────────────────────────────────

  async add(
    digest: string,
    by: string,
    opts: { kind?: 'wasm' | 'system'; note?: string } = {},
  ): Promise<WhitelistEntry> {
    const normalized = normalizeDigest(digest);
    await this.whitelist.save(
      this.whitelist.create({
        digest: normalized,
        kind: opts.kind ?? (normalized.includes('@') ? 'system' : 'wasm'),
        addedBy: by,
        note: opts.note ?? null,
      }),
    );
    this.logger.log(`白名单加入 ${normalized}（by ${by}）`);
    return { digest: normalized, kind: opts.kind ?? 'wasm', addedBy: by, note: opts.note ?? null };
  }

  async remove(digest: string): Promise<void> {
    await this.whitelist.delete({ digest: normalizeDigest(digest) });
    this.logger.log(`白名单移除 ${normalizeDigest(digest)}`);
  }

  async list(): Promise<LocalMdopOperatorWhitelist[]> {
    return this.whitelist.find({ order: { addedAt: 'ASC' } });
  }

  async isWhitelisted(digest: string): Promise<boolean> {
    const row = await this.whitelist.findOne({ where: { digest: normalizeDigest(digest) } });
    return !!row;
  }

  // ── 清单（随长轮询下发，注册中心公钥验签）──────────────────────────────

  /**
   * 收下并验签算子清单。**只更新清单，不碰白名单** —— 平台消息无法给算子加白。
   * 返回通过验签的清单数量（签名不对的整条丢弃并告警）。
   */
  async applyOperatorManifests(
    payload:
      | Array<{
          ref: string;
          digest: string;
          /** 清单对象（解析器会做严格校验，故这里收宽类型）。 */
          manifest: unknown;
          signature: unknown;
        }>
      | undefined,
  ): Promise<number> {
    if (!payload) return 0;
    const registryKey = this.platformKey('registry');
    if (!registryKey) {
      this.logger.warn('未配置 CONNECTOR_REGISTRY_PUBKEY：清单全部拒绝（fail-closed）');
      return 0;
    }
    let accepted = 0;
    for (const item of payload) {
      try {
        const manifest = parseOperatorManifest(item.manifest);
        if (!verifyObjectWithKid(manifest, item.signature, registryKey)) {
          this.logger.warn(`算子清单验签失败，已丢弃：${item.ref}`);
          continue;
        }
        this.manifests.set(item.ref, manifest);
        accepted += 1;
      } catch (err) {
        this.logger.warn(`算子清单非法，已丢弃 ${item.ref}：${(err as Error).message}`);
      }
    }
    return accepted;
  }

  manifestFor(ref: string): OperatorManifest | undefined {
    return this.manifests.get(ref);
  }

  manifestCount(): number {
    return this.manifests.size;
  }

  // ── 吊销名单（平台节点密钥签 + 版本单调 + 落盘）────────────────────────

  /**
   * 收下并验 MDOP 吊销名单。用**部署固定的平台节点公钥**验签；版本回退一律拒
   * （继续用本地版本）。返回值表示是否采纳。
   */
  async applyRevocationList(list: OperatorRevocationList | undefined): Promise<boolean> {
    if (!list) return false;
    const platformKey = this.platformKey('platform-node');
    if (!platformKey) {
      this.logger.warn('未配置 CONNECTOR_PLATFORM_NODE_PUBKEY：吊销名单拒收（fail-closed）');
      return false;
    }
    let parsed: OperatorRevocationList;
    try {
      parsed = parseRevocationList(list);
    } catch (err) {
      this.logger.warn(`吊销名单结构非法，拒收：${(err as Error).message}`);
      return false;
    }
    if (!verifyRevocationList(parsed, platformKey)) {
      this.logger.warn('吊销名单验签失败，拒收');
      return false;
    }
    const local = await this.revocationState.findOne({ where: { id: 'current' } });
    try {
      assertMonotonicVersion(
        parsed,
        local ? { version: local.version, revoked_digests: local.revokedDigests } : null,
      );
    } catch (err) {
      this.logger.warn(`吊销名单版本检查未通过：${(err as Error).message}`);
      return false;
    }
    await this.revocationState.save(
      this.revocationState.create({
        id: 'current',
        version: parsed.version,
        revokedDigests: [...parsed.revoked_digests],
        issuedAt: parsed.issued_at,
        receivedAt: new Date().toISOString(),
      }),
    );
    this.logger.log(`吊销名单已更新 version=${parsed.version}（${parsed.revoked_digests.length} 条）`);
    return true;
  }

  /** 启动后是否已经拿到并验过一份有效名单（没有 → 拒绝执行 wasm）。 */
  async hasValidRevocationList(): Promise<boolean> {
    const row = await this.revocationState.findOne({ where: { id: 'current' } });
    return !!row;
  }

  async revokedDigests(): Promise<string[]> {
    const row = await this.revocationState.findOne({ where: { id: 'current' } });
    return row?.revokedDigests ?? [];
  }

  /**
   * 复核/执行前的执行前闸门：白名单 + 吊销 + 名单已同步。
   * 任一不过抛 `OperatorNotAllowedError`（错误码与协议一致）。
   */
  async assertExecutable(digest: string, kind: 'wasm' | 'system' = 'wasm'): Promise<void> {
    const normalized = normalizeDigest(digest);
    if (!(await this.isWhitelisted(normalized))) {
      throw new OperatorNotAllowedError(
        'E_OP_NOT_WHITELISTED',
        `算子摘要 ${normalized} 不在本院白名单里（缺省为空，需院内按摘要加入）`,
      );
    }
    if (kind !== 'wasm') return;
    if (!(await this.hasValidRevocationList())) {
      throw new OperatorNotAllowedError(
        'E_REVOCATION_UNSYNCED',
        '尚未同步到有效的算子吊销名单：拒绝执行 wasm 算子（fail-closed）',
      );
    }
    const revoked = await this.revokedDigests();
    // 两边都归一后再比：吊销名单里是 `sm3:<hex>`，白名单里是裸 hex —— 不归一会漏判（放过已吊销算子）
    if (revoked.map(normalizeDigest).includes(normalized)) {
      throw new OperatorNotAllowedError('E_OP_REVOKED', `算子 ${normalized} 已被吊销`);
    }
  }

  // ── 能力通告（任务 6.5）────────────────────────────────────────────────

  async capabilityAdvertise(): Promise<CapabilityAdvertise> {
    const rows = await this.list();
    return {
      runtime: ['native', 'wasm'],
      // 本连接器自带的 system 机制算子（数据源 / 降密 / 合并由平台侧承担）
      system_ops: ['source.dataset@1.0.0', 'declassify.small_cell@1.0.0'],
      whitelist_digests: rows.map((r) => r.digest),
      /**
       * **恒为 `null`，且这是设计意图而非待办**（任务 6.3 / D-MDOP-6）：
       * 连接器是**数据持有方**的组件，不是可信空间节点——它没有硬件飞地、也没有远程证明，
       * 因此 MUST NOT 通告 TEE 能力。**通告 TEE 能力的是可信空间节点自己**（§3 的组件，
       * 有自己的参与方身份与证明代理）；平台按各自的通告分别放置 C2 阶段。
       *
       * 任何「让连接器也声明一下 TEE、好让 C2 跑起来」的想法都与 C2 的前提冲突：
       * 那等于用软件隔离冒充硬件证明（`packages/mdop` 的 `verifyAttestationForC2` 会直接拒）。
       */
      tee: null,
      protocols: [],
    };
  }

  /** 该节点是否通告了某个等级要求的能力（编译器放置用）。 */
  static supportsLabel(cap: CapabilityAdvertise, label: FlowLabel): boolean {
    if (label === 'C2') return cap.tee !== null;
    if (label === 'C1') return cap.protocols.length > 0;
    return true;
  }

  private platformKey(purpose: 'platform-node' | 'registry'): string {
    const override = this.deps.platformPublicKeyOverrides?.[purpose];
    if (override) return override;
    return platformPublicKey(purpose);
  }
}

/** 摘要归一化：`sm3:` 前缀可选、大小写不敏感；system 标识原样。 */
export function normalizeDigest(digest: string): string {
  const value = (digest ?? '').trim();
  if (!value) throw new Error('算子摘要不能为空');
  if (value.includes('@')) return value;
  return value.toLowerCase().replace(/^sm3:/, '');
}
