// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import {
  CollaborationEntity,
  DataProduct,
  SpaceEntity,
  SpaceMemberEntity,
  User,
} from "@medtrust/database";
import { SPACE_ID } from "@medtrust/demo-scenario";
import {
  POWER_DEMO_USERS,
  POWER_PACK_ID,
  POWER_SCENARIOS,
  POWER_SPACE_ID,
  POWER_SPACE_NAME,
  powerCatalogProducts,
  type PowerDemoUser,
} from "@medtrust/domain-power";
import {
  MED_PACK_ID,
  SpacePackRegistryService,
} from "./space-pack-registry.service";

interface SeedRepos {
  spaces: Repository<SpaceEntity>;
  products: Repository<DataProduct>;
  collaborations: Repository<CollaborationEntity>;
}

/**
 * 电力空间、三个协作与目录种子。
 *
 * 仅当部署白名单包含电力包时运行。已有目录保持原空间；
 * 只为电力演示机构写成员。草稿种子写进电力空间的用户级成员会撤回。
 */
@Injectable()
export class PowerSpaceSeedService implements OnModuleInit {
  private readonly logger = new Logger(PowerSpaceSeedService.name);

  constructor(
    private readonly packs: SpacePackRegistryService,
    @InjectRepository(SpaceEntity, "controlplane")
    private readonly spaces: Repository<SpaceEntity>,
    @InjectRepository(DataProduct, "controlplane")
    private readonly products: Repository<DataProduct>,
    @InjectRepository(CollaborationEntity, "controlplane")
    private readonly collaborations: Repository<CollaborationEntity>,
    @InjectRepository(SpaceMemberEntity, "controlplane")
    private readonly members: Repository<SpaceMemberEntity>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @Optional()
    @InjectDataSource("controlplane")
    private readonly dataSource?: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.packs.allowedPacks().includes(POWER_PACK_ID)) {
      this.logger.log("电力包不在部署白名单内，不创建电力空间");
      return;
    }
    await this.bindDefaultSpacePack();
    await this.retractLegacyUserMembers();
    const participants = await this.seedDemoUsers();
    await this.seedAll(participants);
    this.packs.enableForSpace({ spaceId: POWER_SPACE_ID }, [POWER_PACK_ID]);
    this.logger.log(`电力空间 ${POWER_SPACE_ID} 已就绪`);
  }

  /** 默认空间显式启用医疗包。已有启用集不覆盖。仅在电力包获授权后调用。 */
  async bindDefaultSpacePack(): Promise<void> {
    const med = await this.spaces.findOne({ where: { id: SPACE_ID } });
    if (!med) return;
    if (!med.enabledPacks || med.enabledPacks.length === 0) {
      med.enabledPacks = [MED_PACK_ID];
      await this.spaces.save(med);
    }
    if (this.packs.allowedPacks().includes(MED_PACK_ID)) {
      this.packs.enableForSpace({ spaceId: SPACE_ID }, [MED_PACK_ID]);
    }
  }

  /** 空间、协作与产品同一次写入。有数据源时包在一个事务里。 */
  async seedAll(
    participantsByScenario: Map<string, string[]> = new Map(),
  ): Promise<number> {
    const repos = (): SeedRepos => ({
      spaces: this.spaces,
      products: this.products,
      collaborations: this.collaborations,
    });
    if (this.dataSource) {
      return this.dataSource.transaction(async (em) =>
        this.seedWithin(
          {
            spaces: em.getRepository(SpaceEntity),
            products: em.getRepository(DataProduct),
            collaborations: em.getRepository(CollaborationEntity),
          },
          participantsByScenario,
        ),
      );
    }
    return this.seedWithin(repos(), participantsByScenario);
  }

  async seedWithin(
    repos: SeedRepos,
    participantsByScenario: Map<string, string[]> = new Map(),
  ): Promise<number> {
    await this.ensurePowerSpace(repos.spaces);
    const linked = await this.seedCatalog(repos.products);
    await this.ensureCollaborations(
      repos.collaborations,
      linked,
      participantsByScenario,
    );
    return [...linked.values()].reduce((n, ids) => n + ids.length, 0);
  }

  async ensurePowerSpace(
    spaces: Repository<SpaceEntity> = this.spaces,
  ): Promise<SpaceEntity> {
    const existing = await spaces.findOne({ where: { id: POWER_SPACE_ID } });
    if (existing) {
      existing.name = existing.name || POWER_SPACE_NAME;
      const packs = existing.enabledPacks ?? [];
      if (!packs.includes(POWER_PACK_ID)) {
        existing.enabledPacks = [...packs, POWER_PACK_ID];
      }
      existing.status = existing.status ?? "active";
      existing.branding = {
        ...(existing.branding ?? {}),
        title: existing.branding?.title || POWER_SPACE_NAME,
        shortName: existing.branding?.shortName || "河南电力",
      };
      return spaces.save(existing);
    }
    return spaces.save(
      spaces.create({
        id: POWER_SPACE_ID,
        name: POWER_SPACE_NAME,
        description: POWER_SCENARIOS.map((s) => s.title).join("、"),
        status: "active",
        enabledPacks: [POWER_PACK_ID],
        branding: {
          title: POWER_SPACE_NAME,
          shortName: "河南电力",
          primary: "#1d4ed8",
          accent: "#d97706",
        },
      }),
    );
  }

  /**
   * 只插入或更新本空间的产品。homeSpace 已是别的空间则跳过。
   * 新行未确权、行数为 0；已存在的本空间产品不改确权与行数。
   */
  async seedCatalog(
    products: Repository<DataProduct> = this.products,
  ): Promise<Map<string, string[]>> {
    const linked = new Map<string, string[]>();
    for (const scenario of POWER_SCENARIOS) linked.set(scenario.id, []);
    for (const product of powerCatalogProducts()) {
      const scenario = POWER_SCENARIOS.find((s) => s.id === product.scenarioId);
      const urn = `urn:tds:${POWER_SPACE_ID}:${product.id}`;
      const existing =
        (await products.findOne({ where: { id: product.id } })) ??
        (await products.findOne({ where: { urn } }));
      if (existing && existing.homeSpace !== POWER_SPACE_ID) {
        this.logger.warn(
          `跳过 ${product.id}：已属于空间 ${existing.homeSpace}`,
        );
        continue;
      }
      const fhirSchema = {
        scenarioId: product.scenarioId,
        scenarioTitle: scenario?.title ?? product.scenarioId,
        fields: product.fields,
      };
      if (existing) {
        existing.title = product.title;
        existing.providerId = product.providerId;
        existing.classification = product.classification;
        existing.fhirSchema = fhirSchema;
        if (!existing.rightsConfirmed) existing.status = "draft";
        existing.updatedAt = new Date();
        await products.save(existing);
      } else {
        await products.save(
          products.create({
            id: product.id,
            urn,
            homeSpace: POWER_SPACE_ID,
            providerId: product.providerId,
            title: product.title,
            productType: "data",
            classification: product.classification,
            status: "draft",
            rightsConfirmed: false,
            recordCount: 0,
            fhirSchema,
          }),
        );
      }
      linked.get(product.scenarioId)?.push(product.id);
    }
    return linked;
  }

  async ensureCollaborations(
    collaborations: Repository<CollaborationEntity> = this.collaborations,
    linked: Map<string, string[]> = new Map(),
    participantsByScenario: Map<string, string[]> = new Map(),
  ): Promise<void> {
    for (const scenario of POWER_SCENARIOS) {
      const dataProductIds = linked.get(scenario.id) ?? [];
      const seeded = participantsByScenario.get(scenario.id) ?? [];
      const existing = await collaborations.findOne({
        where: { spaceId: POWER_SPACE_ID, name: scenario.title },
      });
      if (existing) {
        existing.description = scenario.purpose;
        existing.dataProductIds = dataProductIds;
        const current = existing.participants ?? [];
        if (current.length === 0) existing.participants = seeded;
        await collaborations.save(existing);
        continue;
      }
      await collaborations.save(
        collaborations.create({
          spaceId: POWER_SPACE_ID,
          name: scenario.title,
          description: scenario.purpose,
          participants: seeded,
          dataProductIds,
          status: "active",
        }),
      );
    }
  }

  /**
   * 草稿种子曾把运营方按用户 id 写入电力空间（`invitedBy = power-space-seed`）。
   * 新种子只写电力机构。启动时撤回这类用户行；医疗空间里的同一行、以及人工邀请的成员保留。
   */
  async retractLegacyUserMembers(): Promise<number> {
    const result = await this.members.delete({
      spaceId: POWER_SPACE_ID,
      subjectType: "user",
      invitedBy: "power-space-seed",
    });
    const removed = result.affected ?? 0;
    if (removed > 0) {
      this.logger.warn(
        `已从 ${POWER_SPACE_ID} 撤回 ${removed} 条旧的用户级成员`,
      );
    }
    return removed;
  }

  /**
   * 协作单位演示账号。只加入电力空间，不写入默认医疗空间。
   * 已有邮箱不改密码、不改已绑定的机构。协作参与方已有名单时不覆盖。
   * 生产环境默认不播种，与医疗演示账号同一开关。
   */
  async seedDemoUsers(): Promise<Map<string, string[]>> {
    const byScenario = new Map<string, string[]>();
    for (const scenario of POWER_SCENARIOS) byScenario.set(scenario.id, []);
    if (!demoUsersEnabled()) return byScenario;
    for (const demo of POWER_DEMO_USERS) {
      const ready = await this.ensureDemoUser(demo);
      if (!ready) continue;
      await this.ensureOrgMember(demo);
      for (const scenarioId of demo.scenarioIds) {
        byScenario.get(scenarioId)?.push(demo.participantId);
      }
    }
    return byScenario;
  }

  private async ensureDemoUser(demo: PowerDemoUser): Promise<boolean> {
    const existing = await this.users.findOne({ where: { email: demo.email } });
    if (existing) {
      if (
        existing.participantId &&
        existing.participantId !== demo.participantId
      ) {
        this.logger.warn(
          `跳过 ${demo.email}：已绑定机构 ${existing.participantId}`,
        );
        return false;
      }
      return true;
    }
    await this.users.save(
      this.users.create({
        email: demo.email,
        name: demo.name,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
        participantId: demo.participantId,
        participantRole: demo.role,
        status: "active",
      }),
    );
    return true;
  }

  private async ensureOrgMember(demo: PowerDemoUser): Promise<void> {
    const existing = await this.members.findOne({
      where: {
        spaceId: POWER_SPACE_ID,
        subjectType: "org",
        subjectId: demo.participantId,
      },
    });
    if (existing) return;
    await this.members.save(
      this.members.create({
        spaceId: POWER_SPACE_ID,
        subjectType: "org",
        subjectId: demo.participantId,
        role: demo.role,
        status: "active",
        invitedBy: "power-space-seed",
        joinedAt: new Date(),
      }),
    );
  }
}

const DEMO_PASSWORD = "demo123456";

function demoUsersEnabled(): boolean {
  const flag = process.env.SEED_DEMO_USERS?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}
