import { Injectable, Logger } from "@nestjs/common";
import type { OperatorRevocationList } from "@medtrust/mdop";
import { CaService } from "../runtime/participant-identity/ca.service";
import { MdopOperatorRegistryService } from "./operator-registry.service";

/**
 * MDOP 算子吊销名单（闸 5 / 任务 6.4）。
 *
 * 与既有模块吊销共用同一份「哪些摘要被吊销」的事实（`cp_module_revocation`），
 * 但**签名密钥换成平台节点密钥**（D-MDOP-3 三钥分离），结构换成
 * `OperatorRevocationList`，随长轮询下发。连接器验签、落盘、只接受更高版本；
 * 启动后在收到有效名单之前拒绝执行任何 wasm 算子。
 *
 * 私钥不离开 CaService：签名走它的 `signObjectWith("platform-node", …)`，
 * 与连接器侧的 `verifyRevocationList`（packages/mdop）同一口径。
 */
@Injectable()
export class MdopRevocationService {
  private readonly logger = new Logger(MdopRevocationService.name);

  constructor(
    private readonly ca: CaService,
    private readonly registry: MdopOperatorRegistryService,
  ) {}

  /** 去掉 `sig` 的名单对象（签名内容）。 */
  private coreOf(
    snapshot: { version: number; revoked_digests: string[] },
    now: Date,
  ) {
    return {
      version: snapshot.version,
      issued_at: now.toISOString(),
      revoked_digests: [...snapshot.revoked_digests].sort(),
    };
  }

  /** 已签名的吊销名单；读取失败返回 undefined（连接器据此保持 fail-closed）。 */
  async signedList(
    now: Date = new Date(),
  ): Promise<OperatorRevocationList | undefined> {
    try {
      const snapshot = await this.registry.revocationSnapshot();
      const core = this.coreOf(snapshot, now);
      const sig = this.ca.signObjectWith("platform-node", core);
      return { ...core, sig };
    } catch (err) {
      this.logger.error(`吊销名单签名失败：${(err as Error).message}`);
      return undefined;
    }
  }

  /** 用部署固定的平台节点公钥核验（连接器侧走同一份 packages/mdop 实现）。 */
  verify(list: OperatorRevocationList): boolean {
    return this.ca.verifyObjectWith(
      "platform-node",
      {
        version: list.version,
        issued_at: list.issued_at,
        revoked_digests: list.revoked_digests,
      },
      list.sig,
    );
  }
}
