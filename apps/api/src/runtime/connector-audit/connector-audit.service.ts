import { Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConnectorAuditDigest } from "@medtrust/database";
import { SpaceContextService } from "../space-context/space-context.service";
import {
  rowVisibleInSpace,
  spaceIdForWrite,
} from "../space-context/space-visibility";

export interface BlockedEvent {
  action: string;
  actor: string;
  detail?: string;
  entryHash: string;
  prevHash: string;
  at: string;
}

export interface AuditDigestInput {
  count: number;
  firstPrevHash: string;
  lastEntryHash: string | null;
  blocked?: BlockedEvent[];
}

// 平台侧连接器审计摘要接收与完整性查验(TC609 P0-6)。连接器上报本地审计链摘要,
// 平台按链式 prevHash 对拍判断链条是否连续(chainOk=ok/break)。
@Injectable()
export class ConnectorAuditService {
  constructor(
    @InjectRepository(ConnectorAuditDigest, "controlplane")
    private readonly repo: Repository<ConnectorAuditDigest>,
    @Optional() private readonly spaces?: SpaceContextService,
  ) {}

  async record(
    participantId: string,
    input: AuditDigestInput,
  ): Promise<ConnectorAuditDigest> {
    const prev = (
      await this.repo.find({
        where: { participantId },
        order: { receivedAt: "DESC" },
        take: 1,
      })
    )[0];

    // 链式校验:本次链头(firstPrevHash / 首条阻断事件 prevHash)应接上次链尾(lastEntryHash)。
    const chainHead = input.blocked?.[0]?.prevHash ?? input.firstPrevHash;
    let chainOk = "ok";
    if (prev && prev.lastEntryHash && chainHead !== prev.lastEntryHash) {
      chainOk = "break";
    }

    return this.repo.save(
      this.repo.create({
        participantId,
        count: input.count,
        firstPrevHash: input.firstPrevHash,
        lastEntryHash: input.lastEntryHash ?? undefined,
        chainOk,
        blockedEvents: input.blocked ?? [],
        spaceId: spaceIdForWrite(this.spaces?.current()?.spaceId),
      }),
    );
  }

  async list(participantId?: string): Promise<ConnectorAuditDigest[]> {
    const rows = participantId
      ? await this.repo.find({
          where: { participantId },
          order: { receivedAt: "DESC" },
        })
      : await this.repo.find({ order: { receivedAt: "DESC" } });
    const current = this.spaces?.current()?.spaceId;
    return rows.filter((row) => rowVisibleInSpace(row, current));
  }
}
