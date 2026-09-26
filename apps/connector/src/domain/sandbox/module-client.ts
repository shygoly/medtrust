// algorithm-sandbox / third-party-module-admission — 模块分发、缓存与吊销名单。
//
// 模块字节从控制面 `GET /api/v1/connector/modules/:sm3` 按 SM3 拉取(复用连接器鉴权),
// 校验通过后按 SM3 缓存在内存里,同一任务/同一模块不重复下载。
// 缓存的是"已通过全部校验"的模块 —— 校验失败的一律不缓存、不执行。
//
// 吊销(闸 5):名单随长轮询批次下发,版本单调递增(只接受更高版本,防回放)。
// 名单一更新就**清掉被吊销模块的缓存** —— 否则已缓存的模块会绕过吊销继续跑。
import { Injectable, Optional } from '@nestjs/common';
import {
  EMPTY_REVOCATION_LIST,
  findRevocation,
  mergeRevocationList,
  type RevocationList,
} from '@medtrust/wasm-algorithms';
import { AuditService } from '../audit';
import { ControlPlaneClient } from '../control-plane-client';
import { assertSupportedAbi, verifyModule } from './module-verifier';

export interface PinnedModuleRef {
  analysisType: string;
  sm3: string;
}

export interface ReadyModule {
  analysisType: string;
  sm3: string;
  signature: string;
  abiVersion: number;
  bytes: Uint8Array;
  /** 闸 1 报告（abi_version 导出形态、内存页数、逐条检查项）。 */
  gate?: unknown;
}

@Injectable()
export class ConnectorModuleClient {
  private readonly cache = new Map<string, ReadyModule>();
  /** 当前吊销名单（尚未收到任何名单时为 version=0 的空名单）。 */
  private revocations: RevocationList = EMPTY_REVOCATION_LIST;

  constructor(
    private readonly controlPlane: ControlPlaneClient,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** 清空缓存(测试/换密钥时使用)。 */
  clear(): void {
    this.cache.clear();
    this.revocations = EMPTY_REVOCATION_LIST;
  }

  /**
   * 收下平台随批次下发的吊销名单(闸 5)。
   * 只接受版本更高的名单;更新后立刻清掉被吊销模块的缓存 —— 已缓存的模块
   * 不得凭缓存绕过吊销继续执行。
   */
  applyRevocationList(incoming?: RevocationList): void {
    if (!incoming) return;
    const merged = mergeRevocationList(this.revocations, incoming);
    if (merged === this.revocations) return; // 旧名单(含回放)一律忽略
    this.revocations = merged;
    let evicted = 0;
    for (const sm3 of [...this.cache.keys()]) {
      if (findRevocation(merged, sm3)) {
        this.cache.delete(sm3);
        evicted += 1;
      }
    }
    this.audit?.record({
      action: 'module-revocation-list',
      actor: 'wasm-sandbox',
      allowed: true,
      detail:
        `version=${merged.version} revoked=${merged.revoked.length} evictedFromCache=${evicted}`,
    });
  }

  /** 当前吊销名单（PEP 执行前检查用）。 */
  revocationList(): RevocationList {
    return this.revocations;
  }

  /** 该 SM3 是否已被吊销。 */
  isRevoked(sm3: string): boolean {
    return findRevocation(this.revocations, sm3) !== undefined;
  }

  /** 注册中心公钥（P-CTL-6 的专用算法签名密钥，与 CA 根钥按用途分离）。 */
  registryPublicKey(): string {
    return process.env.CONNECTOR_REGISTRY_PUBKEY ?? '';
  }

  /**
   * 取一份**已通过全部运行前校验**的模块:未被吊销、SM3 等于合约固定值、
   * 签名能用部署配置里固定的平台 CA 公钥验过、且过闸 1 静态白名单。
   * 任一失败即抛出,调用方必须让任务失败(不回退到内置实现)。
   */
  async getVerifiedModule(ref: PinnedModuleRef): Promise<ReadyModule> {
    const cached = this.cache.get(ref.sm3);
    if (cached) return cached;

    const payload = await this.controlPlane.fetchModule(ref.sm3);
    if (payload.sm3.toLowerCase() !== ref.sm3.toLowerCase()) {
      throw new Error(
        `控制面返回的模块 SM3 与请求不符:${payload.sm3} ≠ ${ref.sm3}`,
      );
    }
    const bytes = Buffer.from(payload.bytes, 'base64');
    const verified = verifyModule(new Uint8Array(bytes), {
      analysisType: ref.analysisType,
      expectedSm3: ref.sm3,
      signature: payload.signature,
      registryPublicKey: this.registryPublicKey(),
      // 闸 5:吊销名单一并带进校验 —— 吊销即拒,且不回退到内置实现。
      revocationList: this.revocations,
    });
    assertSupportedAbi(payload.abiVersion);

    const ready: ReadyModule = {
      analysisType: ref.analysisType,
      sm3: verified.sm3,
      signature: payload.signature,
      abiVersion: payload.abiVersion,
      bytes: new Uint8Array(bytes),
      gate: verified.gate,
    };
    this.cache.set(ref.sm3, ready);
    this.audit?.record({
      action: 'sandbox-module-verified',
      actor: ref.analysisType,
      allowed: true,
      detail:
        `sm3=${ready.sm3} abi=${ready.abiVersion} bytes=${ready.bytes.length}` +
        `(吊销检查 + SM3 + 平台CA签名 + 闸1静态白名单 全部通过)`,
    });
    return ready;
  }
}
