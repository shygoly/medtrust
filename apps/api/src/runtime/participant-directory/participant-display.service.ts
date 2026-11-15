import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { ParticipantIdentity } from "@medtrust/database";

/**
 * 参与方展示名解析（目录浏览 / 合约浏览共用）。
 *
 * 合约与目录里存的是平台 slug（`p-demohospa`），`cp_participant` 才有登记机构名。
 * 本服务只做只读批量解析：查不到、查询失败一律返回空，由调用方回退 slug ——
 * **显示名不是业务前提**，不得因为解析失败让列表/详情整页失败。
 */
@Injectable()
export class ParticipantDisplayService {
  constructor(
    @InjectRepository(ParticipantIdentity, "controlplane")
    private readonly participants: Repository<ParticipantIdentity>,
  ) {}

  /** 批量解析：`participantId → org`。缺失的 id 不出现在返回的 Map 里。 */
  async names(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [
      ...new Set(
        ids.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    ];
    const map = new Map<string, string>();
    if (!unique.length) return map;
    try {
      const rows = await this.participants.find({
        where: { participantId: In(unique) },
        select: { participantId: true, org: true },
      });
      for (const row of rows) {
        if (row.participantId && row.org) map.set(row.participantId, row.org);
      }
    } catch {
      // 展示名是锦上添花：库不可用/字段缺失时静默回退 slug。
    }
    return map;
  }

  /** 单条解析；查不到返回 undefined。 */
  async name(id: string): Promise<string | undefined> {
    return (await this.names([id])).get(id);
  }
}
