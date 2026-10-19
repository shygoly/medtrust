#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromDatabase = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const Database = requireFromDatabase("better-sqlite3");
const { Client } = requireFromDatabase("pg");
const { DataSource } = requireFromDatabase("typeorm");
const {
  controlPlaneEntities,
  connectorEntities,
} = requireFromDatabase("./dist");

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const flag = (name) => argv.includes(name);

const mode = arg("--mode");
const sqlitePath = arg("--sqlite");
const postgresUrl = arg("--postgres");
const replace = flag("--replace");
const dryRun = flag("--dry-run");
if (
  !["controlplane", "connector"].includes(mode) ||
  !sqlitePath ||
  !postgresUrl
) {
  console.error(
    "usage: node scripts/migrate-sqlite-to-postgres.mjs --mode controlplane|connector --sqlite <file> --postgres <url> [--dry-run] [--replace]",
  );
  process.exit(2);
}
if (!/^postgres(ql)?:\/\//.test(postgresUrl))
  throw new Error("--postgres must be a postgres:// URL");

const source = new Database(resolve(sqlitePath), {
  readonly: true,
  fileMustExist: true,
});
const entities = mode === "controlplane" ? controlPlaneEntities : connectorEntities;
const metadataSource = new DataSource({
  type: "postgres",
  url: postgresUrl,
  entities,
});
await metadataSource.buildMetadatas();
const metadata = new Map(
  metadataSource.entityMetadatas.map((entity) => [entity.tableName, entity]),
);

const sourceTables = source
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name)
  .filter((name) => metadata.has(name));

const orderedByMetadata = orderByRelations(sourceTables, metadata);
const counts = Object.fromEntries(
  orderedByMetadata.map((table) => [
    table,
    source.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n,
  ]),
);
console.log(JSON.stringify({ mode, tables: counts }, null, 2));
if (dryRun) {
  source.close();
  process.exit(0);
}

const dataSource = new DataSource({
  type: "postgres",
  url: postgresUrl,
  entities,
  synchronize: true,
});
await dataSource.initialize();
const client = new Client({ connectionString: postgresUrl });
await client.connect();
const ordered = await orderByForeignKeys(sourceTables, client);

try {
  await client.query("BEGIN");
  if (replace) {
    for (const table of [...ordered].reverse())
      await client.query(`DELETE FROM ${quote(table)}`);
  }

  for (const table of ordered) {
    const meta = metadata.get(table);
    const rows = source.prepare(`SELECT * FROM "${table}"`).all();
    for (const row of rows) {
      const columns = meta.columns
        .map((column) => column.databaseName)
        .filter((column) => Object.prototype.hasOwnProperty.call(row, column));
      const values = columns.map((column) => {
        const model = meta.columns.find((candidate) => candidate.databaseName === column);
        return normalizeValue(row[column], model?.type);
      });
      const updateColumns = columns.filter(
        (column) =>
          !meta.primaryColumns.some(
            (primary) => primary.databaseName === column,
          ),
      );
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const conflict = meta.primaryColumns.map((column) => quote(column.databaseName));
      const updates = updateColumns.map(
        (column) => `${quote(column)} = EXCLUDED.${quote(column)}`,
      );
      await client.query(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")})
         VALUES (${placeholders.join(", ")})
         ON CONFLICT (${conflict.join(", ")})
         ${updates.length ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING"}`,
        values,
      );
    }
  }

  const targetCounts = Object.fromEntries(
    await Promise.all(
      ordered.map(async (table) => {
        const result = await client.query(`SELECT count(*)::int AS n FROM ${quote(table)}`);
        return [table, result.rows[0].n];
      }),
    ),
  );
  assertParity(counts, targetCounts);
  await assertCriticalHashes(source, client, mode);
  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "migrated", targetCounts }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
  await dataSource.destroy().catch(() => undefined);
  source.close();
}

function quote(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function normalizeValue(value, type) {
  if (value === undefined) return null;
  if (type === "simple-json") {
    if (value === null || value === "") return null;
    // TypeORM simple-json is JSON text in both SQLite and PostgreSQL. Parsing
    // here would make node-postgres serialize arrays as PostgreSQL array
    // literals, which TypeORM cannot hydrate as JSON.
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  if (type === "boolean") return Boolean(Number(value));
  return value;
}

function orderByRelations(tables, metadata) {
  const remaining = new Set(tables);
  const output = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => {
      const meta = metadata.get(table);
      return meta.relations
        .map((relation) => relation.inverseEntityMetadata.tableName)
        .every((target) => !remaining.has(target) || target === table);
    });
    const batch = ready.length > 0 ? ready : [...remaining];
    batch.sort();
    for (const table of batch) {
      output.push(table);
      remaining.delete(table);
    }
  }
  return output;
}

async function orderByForeignKeys(tables, client) {
  const tableSet = new Set(tables);
  const result = await client.query(`
    SELECT conrelid::regclass::text AS child,
           confrelid::regclass::text AS parent
      FROM pg_constraint
     WHERE contype = 'f'
  `);
  const edges = new Map(tables.map((table) => [table, new Set()]));
  for (const row of result.rows) {
    const child = row.child.replace(/^public\./, "").replace(/"/g, "");
    const parent = row.parent.replace(/^public\./, "").replace(/"/g, "");
    if (tableSet.has(child) && tableSet.has(parent) && child !== parent)
      edges.get(child).add(parent);
  }
  const output = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((table) => [...edges.get(table)].every((parent) => !remaining.has(parent)))
      .sort();
    if (ready.length === 0)
      throw new Error(`foreign-key cycle among: ${[...remaining].sort().join(", ")}`);
    for (const table of ready) {
      output.push(table);
      remaining.delete(table);
    }
  }
  return output;
}

function assertParity(sourceCounts, targetCounts) {
  const mismatches = Object.keys(sourceCounts).filter(
    (table) => sourceCounts[table] !== targetCounts[table],
  );
  if (mismatches.length > 0)
    throw new Error(
      `row-count mismatch: ${mismatches
        .map((table) => `${table} ${sourceCounts[table]}->${targetCounts[table]}`)
        .join(", ")}`,
    );
}

async function assertCriticalHashes(sourceDb, pg, migrationMode) {
  if (migrationMode === "controlplane") {
    const sourceCa = sourceDb
      .prepare("SELECT publicKey FROM cp_ca_keypair ORDER BY spaceId LIMIT 1")
      .get()?.publicKey;
    const targetCa = (await pg.query(
      'SELECT "publicKey" FROM "cp_ca_keypair" ORDER BY "spaceId" LIMIT 1',
    )).rows[0]?.publicKey;
    if (sourceCa !== targetCa)
      throw new Error("CA public-key parity failed");

    const sourceContracts = sourceDb
      .prepare(
        'SELECT id, hash, mdopStatus, holderSignature, platformCountersignature FROM cp_digital_contract ORDER BY id',
      )
      .all();
    const targetContracts = (
      await pg.query(
        'SELECT "id", "hash", "mdopStatus", "holderSignature", "platformCountersignature" FROM "cp_digital_contract" ORDER BY "id"',
      )
    ).rows;
    if (digest(sourceContracts) !== digest(targetContracts))
      throw new Error("contract signature/hash parity failed");
  } else {
    const sourceContracts = sourceDb
      .prepare(
        'SELECT contractId, canonical, holderSignature, platformCountersignature FROM local_mdop_contract ORDER BY contractId',
      )
      .all();
    const targetContracts = (
      await pg.query(
        'SELECT "contractId", "canonical", "holderSignature", "platformCountersignature" FROM "local_mdop_contract" ORDER BY "contractId"',
      )
    ).rows;
    if (digest(sourceContracts) !== digest(targetContracts))
      throw new Error("connector contract parity failed");
  }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
