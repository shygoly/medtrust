import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LocalMdopContract,
  LocalMdopContractPending,
} from '@medtrust/database';
import { parseMdopContract, participantUrn } from '@medtrust/mdop';
import { signSm2, verifySm2 } from '../domain/sm2-sign';
import { loadConnectorPrivateKey } from '../domain/connector-key';
import { platformPublicKey } from '../domain/platform-keys';
import {
  autoConfirmNote,
  isAutoConfirmAllowed,
  loadContractPolicy,
  type MdopLocalContractPolicy,
} from './local-contract-policy';

/**
 * 本地合约库与本地确认流程（D-MDOP-4 / 规格「本地合约库」「合约本地确认与签署」）。
 *
 * 三条硬规矩：
 *  ① **复核只认本地副本**：片段要约随附的合约内容一律不采信（`usableContract` 只读本地表）。
 *  ② **未经确认不签**：人工确认经院内端点或 CLI；自动确认必须由本地策略文件显式点名。
 *  ③ **本地撤销立即生效**：此后引用该合约的片段一律拒，与平台是否已知无关。
 */

export interface ContractOfferBody {
  offer_id: string;
  contract_id: string;
  /** 规范化合约全文（JCS 串）——被签的就是这一串。 */
  canonical: string;
}

export interface ContractAgreement {
  contractId: string;
  canonical: string;
  holderSignature: string;
  /** 复核留痕：`auto(policy)` 或人工确认者标识。 */
  review: string;
}

export interface ContractRevocationNotice {
  contractId: string;
  reason: string;
  revokedAt: string;
  by: string;
}

export interface ContractStoreDeps {
  /** 覆盖私钥来源（测试用）。 */
  privateKey?: string;
  /** 覆盖策略（测试用）。 */
  policy?: MdopLocalContractPolicy;
}

@Injectable()
export class MdopContractStore {
  constructor(
    @InjectRepository(LocalMdopContract)
    private readonly contracts: Repository<LocalMdopContract>,
    @InjectRepository(LocalMdopContractPending)
    private readonly pending: Repository<LocalMdopContractPending>,
    @Optional() @Inject('MDOP_CONTRACT_STORE_DEPS')
    private readonly deps: ContractStoreDeps = {},
  ) {}

  private policy(): MdopLocalContractPolicy {
    return this.deps.policy ?? loadContractPolicy();
  }

  private privateKey(): string {
    const key = this.deps.privateKey ?? loadConnectorPrivateKey();
    if (!key) {
      throw new Error(
        '未配置连接器私钥：无法签署合约（平台不代生成参与方密钥，D-MDOP-3）',
      );
    }
    return key;
  }

  /** 收到的合约要约入本地待确认队列；命中本地策略才自动确认。 */
  async receiveOffer(
    offer: ContractOfferBody,
    now: Date = new Date(),
  ): Promise<{ status: 'pending' | 'agreed' | 'already-agreed'; agreement?: ContractAgreement }> {
    const terms = parseMdopContract(JSON.parse(offer.canonical));
    // 幂等：同一合约已生效/已签过，就不再重复入队或重签（至少一次投递会重发）。
    const existing = await this.contracts.findOne({
      where: { contractId: offer.contract_id },
    });
    // 幂等：本地已有**同一份规范化合约**的签署副本时，不重签，直接把原签名再发一次
    // （返回与首次相同的结果）。这样平台侧重播要约也能重新收齐签名、重新副署，
    // 而连接器不会产生第二份签名；契约文本变了才走重新签署。
    if (existing && existing.canonical === offer.canonical && existing.holderSignature) {
      // 平台发来要约就是「它需要签名」的信号（可能刚重启、副署丢了）。本地已签过同一份
      // 规范化合约时**把原签名再发一次**——不重签、不产生第二份签名，但让平台能重新收齐。
      return {
        status: 'agreed',
        agreement: {
          contractId: existing.contractId,
          canonical: existing.canonical,
          holderSignature: existing.holderSignature,
          review: 'replay',
        },
      };
    }

    const deadlineHours = terms.review.deadline_hours || 72;
    const expiresAt = new Date(now.getTime() + deadlineHours * 3_600_000).toISOString();
    await this.pending.save(
      this.pending.create({
        offerId: offer.offer_id,
        contractId: offer.contract_id,
        canonical: offer.canonical,
        status: 'pending',
        expiresAt,
        decidedBy: null,
        decidedAt: null,
        rejectReason: null,
      }),
    );

    const policy = this.policy();
    if (isAutoConfirmAllowed(policy, offer.contract_id)) {
      const agreement = await this.confirm(offer.offer_id, autoConfirmNote(policy));
      return { status: 'agreed', agreement };
    }
    return { status: 'pending' };
  }

  listPending(): Promise<LocalMdopContractPending[]> {
    return this.pending.find({ where: { status: 'pending' }, order: { receivedAt: 'ASC' } });
  }

  list(): Promise<LocalMdopContract[]> {
    return this.contracts.find({ order: { updatedAt: 'DESC' } });
  }

  get(contractId: string): Promise<LocalMdopContract | null> {
    return this.contracts.findOne({ where: { contractId } });
  }

  /**
   * 确认一份要约：用**本院私钥**签规范化合约，写入本地库，返回要发给平台的 `ContractAgree`。
   * 幂等：已确认过的同一要约直接回放同一签名。
   */
  async confirm(offerId: string, by: string): Promise<ContractAgreement> {
    const row = await this.pending.findOne({ where: { offerId } });
    if (!row) throw new Error(`合约要约不存在：${offerId}`);
    if (row.status === 'rejected') throw new Error('该要约已被拒绝，不能改为确认');
    if (row.status === 'pending' && new Date(row.expiresAt).getTime() < Date.now()) {
      await this.pending.update({ offerId }, { status: 'expired', decidedAt: new Date().toISOString() });
      throw new Error('复核时限已过（超时视同拒绝）');
    }

    const terms = parseMdopContract(JSON.parse(row.canonical));
    const existing = await this.contracts.findOne({ where: { contractId: row.contractId } });
    // 只有「本地副本与本次要约是**同一份规范化合约**」时才回放原签名；
    // 规范化内容变了（例如平台侧重播种后预审快照哈希变化）必须按新内容重签，
    // 否则会把旧签名发给平台、被判定为「签署内容与平台条款不一致」。
    if (
      existing &&
      existing.holderSignature &&
      existing.status !== 'rejected' &&
      existing.canonical === row.canonical
    ) {
      await this.pending.update(
        { offerId },
        { status: 'confirmed', decidedBy: by, decidedAt: new Date().toISOString() },
      );
      return {
        contractId: row.contractId,
        canonical: existing.canonical,
        holderSignature: existing.holderSignature,
        review: 'replay',
      };
    }

    const holderSignature = signSm2(row.canonical, this.privateKey());
    await this.contracts.save(
      this.contracts.create({
        contractId: row.contractId,
        canonical: row.canonical,
        holderSignature,
        // 平台副署到齐前本地副本还不算生效（pending）——见 applyCountersignature。
        platformCountersignature: '',
        status: 'pending',
        reviewMode: terms.review.mode,
        reviewPolicy: by,
        reviewDeadlineHours: terms.review.deadline_hours,
        purposeCode: terms.purpose,
        recipients: terms.recipients.map((r) => r.party),
        publication: terms.publication,
        allowedOpDigests: [...terms.allowed_ops],
        validFrom: terms.valid_from,
        validUntil: terms.valid_until,
        revokedAt: null,
        revokeReason: null,
        terminationSent: false,
        updatedAt: new Date(),
      }),
    );
    await this.pending.update(
      { offerId },
      { status: 'confirmed', decidedBy: by, decidedAt: new Date().toISOString() },
    );
    return { contractId: row.contractId, canonical: row.canonical, holderSignature, review: by };
  }

  async reject(offerId: string, by: string, reason: string): Promise<void> {
    const row = await this.pending.findOne({ where: { offerId } });
    if (!row) throw new Error(`合约要约不存在：${offerId}`);
    if (row.status === 'confirmed') throw new Error('该要约已确认，不能改为拒绝');
    await this.pending.update(
      { offerId },
      {
        status: 'rejected',
        decidedBy: by,
        decidedAt: new Date().toISOString(),
        rejectReason: reason,
      },
    );
  }

  /**
   * 平台副署到齐后本地副本才生效。**必须用部署固定的平台节点公钥验签**——
   * 否则任何能往本地写数据的人都可让一份合约「生效」。
   */
  async applyCountersignature(
    contractId: string,
    countersignature: string,
  ): Promise<LocalMdopContract> {
    const row = await this.contracts.findOne({ where: { contractId } });
    if (!row) throw new Error(`本地没有该合约副本：${contractId}`);
    const platformKey = platformPublicKey('platform-node');
    if (!platformKey) throw new Error('未配置 CONNECTOR_PLATFORM_NODE_PUBKEY（fail-closed）');
    if (!verifySm2(row.canonical, countersignature, platformKey)) {
      throw new Error('平台副署验签失败：拒绝把该合约置为生效');
    }
    await this.contracts.update(
      { contractId },
      { platformCountersignature: countersignature, status: 'active', updatedAt: new Date() },
    );
    return (await this.contracts.findOne({ where: { contractId } })) as LocalMdopContract;
  }

  /**
   * 本地撤销：**立即生效**（本地权威），并返回要发给平台的终止通知。
   * 平台是否送达、是否已知，都不影响本地立刻拒该合约。
   */
  async revoke(
    contractId: string,
    by: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<ContractRevocationNotice> {
    const row = await this.contracts.findOne({ where: { contractId } });
    if (!row) throw new Error(`本地没有该合约副本：${contractId}`);
    if (row.status !== 'revoked') {
      await this.contracts.update(
        { contractId },
        {
          status: 'revoked',
          revokedAt: now.toISOString(),
          revokeReason: reason,
          updatedAt: now,
        },
      );
    }
    return { contractId, reason, revokedAt: now.toISOString(), by };
  }

  /** 平台侧终止（收到 `ContractTerminate`）：标记本地副本，立即不再引用。 */
  async applyTermination(
    contractId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.contracts.update(
      { contractId },
      {
        status: 'revoked',
        revokedAt: now.toISOString(),
        revokeReason: `平台终止：${reason}`,
        updatedAt: now,
      },
    );
  }

  /**
   * 复核用：取本地生效的合约副本。缺失 → `missing`；已撤销/过期 → `revoked`/`expired`。
   * **只读本地库**，不接受任何随消息附带的合约内容。
   */
  async usableContract(
    contractId: string,
    now: Date = new Date(),
  ): Promise<
    | { ok: true; contract: LocalMdopContract }
    | { ok: false; reason: 'missing' | 'revoked' | 'expired' | 'not-active' }
  > {
    const row = await this.contracts.findOne({ where: { contractId } });
    if (!row) return { ok: false, reason: 'missing' };
    if (row.status === 'revoked') return { ok: false, reason: 'revoked' };
    if (row.status !== 'active') return { ok: false, reason: 'not-active' };
    if (new Date(row.validUntil).getTime() < now.getTime())
      return { ok: false, reason: 'expired' };
    return { ok: true, contract: row };
  }

  /** 接收方列表（C0/C3 出节点守卫要用）。 */
  static recipientParties(row: LocalMdopContract): string[] {
    return Array.isArray(row.recipients) ? row.recipients : [];
  }

  /** 平台 party 的 URN（本地合约接收方列表里应含它）。 */
  platformParty(space = process.env.SPACE_ID ?? 'sh-med'): string {
    return participantUrn(space, 'platform');
  }
}
