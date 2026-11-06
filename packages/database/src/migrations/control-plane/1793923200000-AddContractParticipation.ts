import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * contract-review：合约审核页需要的当事人留痕 + 机构注册表的 slug 对齐。
 *
 * 背景：原「合约审核」只有 `consumerId → providerId` 的 slug 与用途，**没有**
 * 申请人、审批人、审批时间；`cp_participant` 也只有 `id uuid + org`，没有平台
 * 实际使用的 slug（`p-demohospa`），两表对不上，机构名无法解析。
 *
 * 只加可空列，不动既有数据：
 * - `cp_digital_contract.requestedBy / decision / revocation`：平台侧留痕，
 *   **不进 canonical**（补记不得让已存证合约验哈希失败）。
 * - `cp_participant.participantId`：唯一索引允许为空（旧行不补），
 *   演示机构的显示名由 `ParticipantDirectorySeedService` 幂等补齐。
 */
export class AddContractParticipation1793923200000 implements MigrationInterface {
  name = "AddContractParticipation1793923200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `ALTER TABLE "cp_digital_contract" ADD COLUMN IF NOT EXISTS "requestedBy" text`,
      `ALTER TABLE "cp_digital_contract" ADD COLUMN IF NOT EXISTS "decision" text`,
      `ALTER TABLE "cp_digital_contract" ADD COLUMN IF NOT EXISTS "revocation" text`,
      `ALTER TABLE "cp_participant" ADD COLUMN IF NOT EXISTS "participantId" character varying`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cp_participant_participant_id" ON "cp_participant" ("participantId")`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `DROP INDEX IF EXISTS "IDX_cp_participant_participant_id"`,
      `ALTER TABLE "cp_participant" DROP COLUMN IF EXISTS "participantId"`,
      `ALTER TABLE "cp_digital_contract" DROP COLUMN IF EXISTS "revocation"`,
      `ALTER TABLE "cp_digital_contract" DROP COLUMN IF EXISTS "decision"`,
      `ALTER TABLE "cp_digital_contract" DROP COLUMN IF EXISTS "requestedBy"`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }
}
