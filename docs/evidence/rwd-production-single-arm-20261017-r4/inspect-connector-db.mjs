const Database = require('better-sqlite3');

const db = new Database('/repo/apps/connector/data/connector-local.db', {
  readonly: true,
});
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name);
console.log(JSON.stringify({ tables }, null, 2));

for (const table of tables) {
  const lower = table.toLowerCase();
  if (!lower.includes('contract') && !lower.includes('mdop')) continue;
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name);
  console.log(`\nTABLE ${table}\n${columns.join(', ')}`);
  const rows = db.prepare(`SELECT * FROM "${table}" LIMIT 20`).all();
  console.log(JSON.stringify(rows, null, 2));
}

db.close();
