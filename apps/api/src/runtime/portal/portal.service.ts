import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DataProduct, ParticipantIdentity } from "@medtrust/database";
import { SPACE_ID } from "@medtrust/demo-scenario";

// P1-10:公开门户只读数据。未登录访客可浏览数据产品目录与机构大厅;
// 只暴露元数据,不含任何行级医疗数据与敏感字段。
@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(DataProduct, "controlplane")
    private readonly products: Repository<DataProduct>,
    @InjectRepository(ParticipantIdentity, "controlplane")
    private readonly participants: Repository<ParticipantIdentity>,
  ) {}

  async listProducts(spaceId: string = SPACE_ID) {
    // 公开目录也必须按空间隔离：调用方（chat-agent 的目录探测）会显式带 spaceId，
    // 早先写死默认空间会让电力空间拿到上海医疗的参与方/产品。
    const homeSpace = spaceId?.trim() || SPACE_ID;
    const rows = await this.products.find({
      where: { status: "active", homeSpace, rightsConfirmed: true },
      order: { createdAt: "DESC" },
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        urn: p.urn,
        title: p.title,
        providerId: p.providerId,
        productType: p.productType,
        classification: p.classification,
        recordCount: p.recordCount,
        rightsConfirmed: p.rightsConfirmed,
        productRoles: p.productRoles ?? productRolesOf(p.fhirSchema),
      })),
      total: rows.length,
    };
  }

  async listInstitutions(_spaceId: string = SPACE_ID) {
    // ParticipantIdentity 尚未按空间分表；筛选逻辑由空间成员表在后续变更补齐。
    // 公开目录仍按产品所属空间严格过滤，不会泄漏其它空间的产品。
    const rows = await this.participants.find({
      order: { createdAt: "DESC" },
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        org: p.org,
        role: p.role,
        region: p.region,
        subjectVerified: p.subjectVerified,
        dataVerified: p.dataVerified,
      })),
      total: rows.length,
    };
  }
}

function productRolesOf(
  schema: Record<string, unknown> | null | undefined,
): string[] {
  const roles = schema?.productRoles;
  return Array.isArray(roles)
    ? roles.filter(
        (role): role is string =>
          typeof role === "string" && role.trim().length > 0,
      )
    : [];
}
