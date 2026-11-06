import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ParticipantIdentity,
  type ParticipantCommercial,
} from "@medtrust/database";

/**
 * 参与方商业属性（P6.5 / D-SPD-13）。
 *
 * 机构主体唯一化：`cp_participant` 是机构身份的唯一权威；
 * 资质 / 配额 / 订阅 / 财务降级为它的商业属性扩展，不再有第二套机构实体（原 Tenant）。
 */
@Injectable()
export class ParticipantCommercialService {
  constructor(
    @InjectRepository(ParticipantIdentity, "controlplane")
    private readonly participants: Repository<ParticipantIdentity>,
  ) {}

  async get(participantId: string): Promise<ParticipantCommercial | null> {
    const row = await this.require(participantId);
    return row.commercial ?? null;
  }

  /** 分段浅合并：只覆盖传入的分区，未传分区保持原值。 */
  async upsert(
    participantId: string,
    patch: ParticipantCommercial,
  ): Promise<ParticipantCommercial> {
    if (!participantId?.trim()) throw new BadRequestException("缺少参与方 id");
    const row = await this.require(participantId);
    const merged: ParticipantCommercial = { ...(row.commercial ?? {}) };
    for (const [section, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const key = section as keyof ParticipantCommercial;
      merged[key] = {
        ...((merged[key] ?? {}) as object),
        ...(value as object),
      } as never;
    }
    row.commercial = merged;
    await this.participants.save(row);
    return merged;
  }

  private async require(participantId: string): Promise<ParticipantIdentity> {
    // 平台内一律用 slug（`p-demohospa`）；`id` 是 uuid，仅为兼容旧调用保留。
    const row = await this.participants.findOne({
      where: [{ participantId }, { id: participantId }],
    });
    if (!row) throw new NotFoundException("参与方不存在");
    return row;
  }
}
