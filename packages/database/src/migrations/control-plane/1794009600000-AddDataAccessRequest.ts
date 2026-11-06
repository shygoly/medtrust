import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 使用方发起「访问授权申请」：提供方批准后才生成 grant。
 *
 * 只建新表，不动 `cp_data_access_grant`：
 * 授权行是已生效事实（追加式、回收留痕），申请是待决请求（可撤回/驳回），
 * 生命周期不同；混表会让「能不能碰」的判定与「谁在等谁」的待办互相污染。
 * pending 申请不参与 `check()`，批准时才由服务调既有 `grant()` 落授权行。
 */
export class AddDataAccessRequest1794009600000 implements MigrationInterface {
  name = "AddDataAccessRequest1794009600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS "cp_data_access_request" (
        "space_id" character varying,
        "id" character varying NOT NULL,
        "dataProductId" character varying NOT NULL,
        "providerId" character varying NOT NULL,
        "requesterParticipantId" character varying NOT NULL,
        "permissions" text NOT NULL,
        "purpose" character varying,
        "note" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "requestedByUserId" character varying,
        "requester" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "decidedAt" TIMESTAMP,
        "decidedBy" text,
        "decisionNote" character varying,
        "grantId" character varying,
        CONSTRAINT "PK_cp_data_access_request" PRIMARY KEY ("id")
      )`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_dar_product" ON "cp_data_access_request" ("dataProductId")`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_dar_requester" ON "cp_data_access_request" ("requesterParticipantId")`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_dar_pending" ON "cp_data_access_request" ("dataProductId", "requesterParticipantId", "status")`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "cp_data_access_request"`);
  }
}
