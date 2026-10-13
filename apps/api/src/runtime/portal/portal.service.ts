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

  async listProducts() {
    const rows = await this.products.find({
      where: { status: "active", homeSpace: SPACE_ID },
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
      })),
      total: rows.length,
    };
  }

  async listInstitutions() {
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
