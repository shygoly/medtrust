#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const requireFromDatabase = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { DataSource } = requireFromDatabase("typeorm");
const { controlPlaneEntities, connectorEntities } = requireFromDatabase("./dist");

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const mode = arg("--mode");
const url = arg("--postgres");
const output = arg("--out");
if (!["controlplane", "connector"].includes(mode) || !url || !output) {
  console.error(
    "usage: generate-postgres-initial-migration --mode controlplane|connector --postgres <empty-db-url> --out <file.ts>",
  );
  process.exit(2);
}

const entities = mode === "controlplane" ? controlPlaneEntities : connectorEntities;
const guardTable = mode === "controlplane" ? "cp_space" : "local_mdop_contract";
const className =
  mode === "controlplane"
    ? "PostgresControlPlaneInitial1750000000000"
    : "PostgresConnectorInitial1750000000000";
const dataSource = new DataSource({
  type: "postgres",
  url,
  entities,
  synchronize: false,
});
await dataSource.initialize();
const sql = await dataSource.driver.createSchemaBuilder().log();
await dataSource.destroy();

const literal = (queries) =>
  queries
    .map(
      (query) =>
        `    [\n      ${JSON.stringify(query.query)},\n      ${JSON.stringify(query.parameters ?? [])},\n    ]`,
    )
    .join(",\n");
const source = `import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Generated from the current TypeORM entity metadata against an empty
 * PostgreSQL database. The guard makes adoption idempotent when a database was
 * bootstrapped before migrations were introduced.
 */
export class ${className} implements MigrationInterface {
  name = "${className}";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("${guardTable}")) return;
    const queries: Array<[string, unknown[]]> = [
${literal(sql.upQueries)}
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const queries: Array<[string, unknown[]]> = [
${literal(sql.downQueries)}
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }
}
`;
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), source, "utf8");
console.log(
  JSON.stringify({
    mode,
    output: resolve(output),
    upQueries: sql.upQueries.length,
    downQueries: sql.downQueries.length,
  }),
);
