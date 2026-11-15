import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 对外推送台账（ndi-catalog-upstream-listing 第 2 步）。
 *
 * 只建新表：推送台账是**对外动作的留痕**（成功/失败/尝试次数），
 * 与本地目录（`cp_data_product`）生命周期无关——推送失败不得影响本地可见性。
 * 幂等靠 `id = target:spaceId:ndiId:版本`，重复推送只更新既有行。
 */
export class AddInteropPushRecord1794100000000 implements MigrationInterface {
  name = "AddInteropPushRecord1794100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS "cp_interop_push_record" (
        "id" character varying NOT NULL,
        "space_id" character varying,
        "target" character varying NOT NULL DEFAULT 'silk-road',
        "objectType" character varying NOT NULL,
        "idempotencyKey" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text,
        "lastPushedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cp_interop_push_record" PRIMARY KEY ("id")
      )`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_ipr_target" ON "cp_interop_push_record" ("target")`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_ipr_key" ON "cp_interop_push_record" ("idempotencyKey")`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "cp_interop_push_record"`);
  }
}
