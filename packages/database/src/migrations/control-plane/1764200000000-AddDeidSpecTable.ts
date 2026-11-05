import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * connector-agent-deidentification：脱敏规格版本表。
 *
 * 只建新表，不动既有表。控制面**只存元数据与签名**（规格 JSON / SM3 / SM2 签名 /
 * 版本 / 吊销状态），不存盐、不存密钥、不存任何行级数据（D1/D7）。
 */
export class AddDeidSpecTable1764200000000 implements MigrationInterface {
  name = "AddDeidSpecTable1764200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS "cp_deid_spec" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "spec_id" character varying NOT NULL,
        "version" integer NOT NULL,
        "specJson" text NOT NULL,
        "spec_sm3" character varying(64) NOT NULL,
        "signature" text NOT NULL,
        "key_id" character varying(64) NOT NULL,
        "scope_product" character varying NOT NULL,
        "scope_level" character varying NOT NULL,
        "issued_at" character varying NOT NULL,
        "not_after" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "issued_by" character varying NOT NULL,
        "revoked_by" character varying,
        "revoke_reason" character varying,
        "revoked_at" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cp_deid_spec" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cp_deid_spec_spec_id_version" ON "cp_deid_spec" ("spec_id", "version")`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_deid_spec_spec_id" ON "cp_deid_spec" ("spec_id")`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "cp_deid_spec"`);
  }
}
