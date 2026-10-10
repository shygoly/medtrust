import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CollaborationEntity } from "@medtrust/database";
import { SpaceMembershipService } from "./space-membership.service";

export interface CreateCollaborationInput {
  spaceId: string;
  name: string;
  description?: string;
  participants: string[];
}

/**
 * 协作与可见性作用域（P8 / D-SPD-3）。
 *
 * 作用域边界：**同空间内的竞争方互不可见**——目录与成员按协作过滤。
 * 协作身份**不构成数据授权**：授权仍由数字合约 + PEP 承担（协作只是可见性视图）。
 */
@Injectable()
export class CollaborationService {
  constructor(
    @InjectRepository(CollaborationEntity, "controlplane")
    private readonly collaborations: Repository<CollaborationEntity>,
    private readonly membership: SpaceMembershipService,
  ) {}

  async create(input: CreateCollaborationInput): Promise<CollaborationEntity> {
    if (!input.spaceId?.trim()) throw new BadRequestException("缺少空间 id");
    if (!input.name?.trim()) throw new BadRequestException("缺少协作名称");
    const participants = [...new Set(input.participants ?? [])].filter((p) =>
      p?.trim(),
    );
    if (!participants.length)
      throw new BadRequestException("协作至少需要一个参与方");
    // 参与方 MUST 是空间成员的子集（D-SPD-3）
    const members = await this.membership.listMembers(input.spaceId);
    const active = new Set(
      members.filter((m) => m.status === "active").map((m) => m.subjectId),
    );
    for (const p of participants) {
      if (!active.has(p)) {
        throw new BadRequestException("协作参与方必须是本空间成员：" + p);
      }
    }
    return this.collaborations.save(
      this.collaborations.create({
        spaceId: input.spaceId,
        name: input.name.trim(),
        description: input.description,
        participants,
        status: "active",
      }),
    );
  }

  list(spaceId: string): Promise<CollaborationEntity[]> {
    return this.collaborations.find({ where: { spaceId } });
  }

  /** 某主体在某空间**可见**的协作（竞争方隔离的核心）。 */
  async listVisible(
    spaceId: string,
    subjectId: string,
  ): Promise<CollaborationEntity[]> {
    const all = await this.list(spaceId);
    return all.filter((c) => (c.participants ?? []).includes(subjectId));
  }

  /** 可见性断言：不可见即拒（用于目录 / 成员查询前的过滤）。 */
  async assertVisible(
    spaceId: string,
    subjectId: string,
    collaborationId: string,
  ): Promise<CollaborationEntity> {
    const row = await this.collaborations.findOne({
      where: { id: collaborationId, spaceId },
    });
    if (!row) throw new NotFoundException("协作不存在");
    if (!(row.participants ?? []).includes(subjectId)) {
      throw new ForbiddenException("无权访问该协作");
    }
    return row;
  }

  async remove(spaceId: string, id: string): Promise<void> {
    const row = await this.collaborations.findOne({ where: { id, spaceId } });
    if (!row) throw new NotFoundException("协作不存在");
    row.status = "archived";
    await this.collaborations.save(row);
  }
}
