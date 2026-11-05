import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * ndi-catalog-upstream-listing（step 1）：目录上报所需的授权、服务规格与披露字段。
 *
 * 只加列，不改类型、不删列、不回填数据：
 * - `listingScope` 缺省 `internal`（存量产品不自动外发）；
 * - 其余列可空，回填由独立脚本按业务需要执行。
 */
export class AddCatalogUpstreamListing1762400000000 implements MigrationInterface {
  name = "AddCatalogUpstreamListing1762400000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `ALTER TABLE "cp_data_product" ADD COLUMN IF NOT EXISTS "listingScope" character varying NOT NULL DEFAULT 'internal'`,
      `ALTER TABLE "cp_data_product" ADD COLUMN IF NOT EXISTS "listingConsent" text`,
      `ALTER TABLE "cp_data_product" ADD COLUMN IF NOT EXISTS "serviceSpec" text`,
      `ALTER TABLE "cp_data_product" ADD COLUMN IF NOT EXISTS "serviceCapacity" integer`,
      `ALTER TABLE "cp_data_product" ADD COLUMN IF NOT EXISTS "provenance" text`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    const statements = [
      `ALTER TABLE "cp_data_product" DROP COLUMN IF EXISTS "provenance"`,
      `ALTER TABLE "cp_data_product" DROP COLUMN IF EXISTS "serviceCapacity"`,
      `ALTER TABLE "cp_data_product" DROP COLUMN IF EXISTS "serviceSpec"`,
      `ALTER TABLE "cp_data_product" DROP COLUMN IF EXISTS "listingConsent"`,
      `ALTER TABLE "cp_data_product" DROP COLUMN IF EXISTS "listingScope"`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }
}
