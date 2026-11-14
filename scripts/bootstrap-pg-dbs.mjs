/**
 * 首次本地 bootstrap：在 Postgres 上创建 medtrust_api / medtrust_controlplane。
 *
 * 用法：
 *   set PG_ADMIN_URL=postgresql://user:pass@host:5432/postgres
 *   node scripts/bootstrap-pg-dbs.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../packages/database/node_modules/pg");

const adminUrl = process.env.PG_ADMIN_URL;
if (!adminUrl) {
  console.error("PG_ADMIN_URL is required, e.g. postgresql://user:pass@host:5432/postgres");
  process.exit(1);
}

const databases = ["medtrust_api", "medtrust_controlplane"];
const admin = new Client({ connectionString: adminUrl });
await admin.connect();

const { rows } = await admin.query(
  "SELECT datname FROM pg_database WHERE datname = ANY($1)",
  [databases],
);
const existing = new Set(rows.map((r) => r.datname));
console.log("existing:", [...existing].join(",") || "(none)");

for (const name of databases) {
  if (existing.has(name)) {
    console.log("skip create", name);
    continue;
  }
  await admin.query(`CREATE DATABASE ${name}`);
  console.log("created", name);
}

await admin.end();
console.log("done");
