import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * connector-agent-deidentification（Phase 2）：脱敏词表清单表。
 *
 * 只建新表，不动既有表。**只存摘要与版本**：词表内容留在医院，
 * 平台签的是「这份摘要就是我审查过的第 N 版」（与盐同向，D-CN-9）。
 */
export class AddDeidDictionaryTable1764300000000 implements MigrationInterface {
  name = "AddDeidDictionaryTable1764300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS "cp_deid_dictionary" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dictionary_id" character varying NOT NULL,
        "version" integer NOT NULL,
        "sm3" character varying(64) NOT NULL,
        "byte_size" integer NOT NULL,
        "signature" text NOT NULL,
        "key_id" character varying(64) NOT NULL,
        "issued_at" character varying NOT NULL,
        "not_after" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "submitted_by" character varying NOT NULL,
        "approved_by" character varying NOT NULL,
        "revoked_by" character varying,
        "revoke_reason" character varying,
        "revoked_at" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cp_deid_dictionary" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cp_deid_dictionary_id_version" ON "cp_deid_dictionary" ("dictionary_id", "version")`,
      `CREATE INDEX IF NOT EXISTS "IDX_cp_deid_dictionary_id" ON "cp_deid_dictionary" ("dictionary_id")`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "cp_deid_dictionary"`);
  }
}
