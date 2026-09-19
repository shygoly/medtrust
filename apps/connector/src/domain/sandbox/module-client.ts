// algorithm-sandbox — 模块分发与缓存(design D6)。
//
// 模块字节从控制面 `GET /api/v1/connector/modules/:sm3` 按 SM3 拉取(复用连接器鉴权),
// 校验通过后按 SM3 缓存在内存里,同一任务/同一模块不重复下载。
// 缓存的是"已通过双重校验"的模块 —— 校验失败的一律不缓存、不执行。
import { Injectable, Optional } from '@nestjs/common';
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
}

@Injectable()
export class ConnectorModuleClient {
  private readonly cache = new Map<string, ReadyModule>();

  constructor(
    private readonly controlPlane: ControlPlaneClient,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** 清空缓存(测试/换密钥时使用)。 */
  clear(): void {
    this.cache.clear();
  }

  platformCaPublicKey(): string {
    return process.env.CONNECTOR_PLATFORM_CA_PUBKEY ?? '';
  }

  /**
   * 取一份**已通过双重校验**的模块:SM3 必须等于合约固定值,签名必须能用部署配置里
   * 固定的平台 CA 公钥验证通过。任一失败即抛出,调用方必须让任务失败。
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
      platformCaPublicKey: this.platformCaPublicKey(),
    });
    assertSupportedAbi(payload.abiVersion);

    const ready: ReadyModule = {
      analysisType: ref.analysisType,
      sm3: verified.sm3,
      signature: payload.signature,
      abiVersion: payload.abiVersion,
      bytes: new Uint8Array(bytes),
    };
    this.cache.set(ref.sm3, ready);
    this.audit?.record({
      action: 'sandbox-module-verified',
      actor: ref.analysisType,
      allowed: true,
      detail: `sm3=${ready.sm3} abi=${ready.abiVersion} bytes=${ready.bytes.length}(SM3+平台CA签名双重校验通过)`,
    });
    return ready;
  }
}
