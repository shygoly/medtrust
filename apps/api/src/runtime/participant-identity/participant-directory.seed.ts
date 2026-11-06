import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ParticipantIdentity, ParticipantRole } from "@medtrust/database";
import { POWER_DEMO_USERS } from "@medtrust/domain-power";

/**
 * 参与方显示名登记（contract-review）。
 *
 * 为什么要它：合约里存的是平台 slug（`p-demohospa`），而 `cp_participant` 建模时
 * 只有 `id uuid + org`，没有 slug 列 —— 于是「哪个机构」在界面上无处可查。
 * 本种子按 `participantId` 幂等补齐显示名；真实部署的机构名仍由准入流程写 `org`。
 *
 * 边界（MUST NOT 越界）：
 * - **不伪造认证**：`subjectVerified/dataVerified` 保持 `false` —— 这些演示机构
 *   从未走过双认证。公开门户会如实显示「未认证」。
 * - **不覆盖既有行**：已有 `participantId` 的行一律跳过，避免把真实机构名改回演示名。
 * - 名称口径：医疗取自 `packages/demo-scenario/src/ckd-scenario.json` 与演示账号；
 *   电力取自 `industries/power` 的 `POWER_DEMO_USERS`（单一定义，不在此复制第二份）。
 */

const MED_DEMO_PARTICIPANTS: ReadonlyArray<{
  participantId: string;
  org: string;
  role: ParticipantRole;
}> = [
  { participantId: "p-demohospa", org: "示范甲医院", role: "provider" },
  { participantId: "p-demohospb", org: "示范乙医院", role: "provider" },
  { participantId: "p-demohospc", org: "示范丙医院", role: "provider" },
  { participantId: "p-huashan", org: "华山医院", role: "provider" },
  { participantId: "p-ruijin", org: "瑞金医院", role: "provider" },
  { participantId: "p-cdc-demo", org: "区疾控中心（演示）", role: "provider" },
  // 与 PARTICIPANT_ALIASES 同口径：p-meddata 是研究机构，不是药企。
  { participantId: "p-meddata", org: "医研数据研究院", role: "consumer" },
  { participantId: "pharma-demo", org: "创新药企（演示）", role: "consumer" },
  { participantId: "p-smartmed", org: "智慧医疗AI", role: "consumer" },
  { participantId: "p-health-gov", org: "区域卫健委", role: "operator" },
  { participantId: "p-compliance", org: "合规审查方", role: "compliance" },
];

/** 电力空间：`POWER_DEMO_USERS.name` 就是机构显示名。 */
const POWER_DEMO_PARTICIPANTS = POWER_DEMO_USERS.map((u) => ({
  participantId: u.participantId,
  org: u.name,
  role: u.role as ParticipantRole,
}));

export const DEMO_PARTICIPANTS = [
  ...MED_DEMO_PARTICIPANTS,
  ...POWER_DEMO_PARTICIPANTS,
  // 电力 MDOP 标准场景的数据分析方（不在 POWER_DEMO_USERS 里，按演示配置补一条）。
  {
    participantId: "p-power-analyst",
    org: "电力数据分析方",
    role: "consumer" as ParticipantRole,
  },
];

@Injectable()
export class ParticipantDirectorySeedService implements OnModuleInit {
  private readonly logger = new Logger(ParticipantDirectorySeedService.name);

  constructor(
    @Optional()
    @InjectRepository(ParticipantIdentity, "controlplane")
    private readonly participants?: Repository<ParticipantIdentity>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.participants) return;
    let inserted = 0;
    for (const p of DEMO_PARTICIPANTS) {
      try {
        const existing = await this.participants.findOne({
          where: { participantId: p.participantId },
        });
        if (existing) continue;
        await this.participants.save(
          this.participants.create({
            participantId: p.participantId,
            org: p.org,
            role: p.role,
            subjectVerified: false,
            dataVerified: false,
          }),
        );
        inserted += 1;
      } catch (error) {
        // 单条冲突（如 org 名称已被真实准入记录占用）不拖累其余条目。
        this.logger.warn(
          `机构显示名未补入 ${p.participantId}：${(error as Error).message}`,
        );
      }
    }
    if (inserted > 0) {
      this.logger.log(`参与方显示名登记：补入 ${inserted} 条演示机构`);
    }
  }
}
