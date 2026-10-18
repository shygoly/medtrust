const Database = require('better-sqlite3');

const jobId = process.argv[2];
if (!jobId) throw new Error('job id required');
const db = new Database('/repo/apps/api/data/control-plane.db', {
  readonly: true,
});
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .filter((row) => /mdop|outbox|receipt/i.test(row.name))
  .map((row) => row.name);

for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
  const hasJob = columns.some((row) => row.name === 'job_id');
  const hasJobCamel = columns.some((row) => row.name === 'jobId');
  if (!hasJob && !hasJobCamel) continue;
  const column = hasJob ? 'job_id' : 'jobId';
  const rows = db
    .prepare(`SELECT * FROM "${table}" WHERE "${column}" = ? ORDER BY rowid ASC`)
    .all(jobId);
  if (rows.length === 0) continue;
  console.log(`\nTABLE ${table}`);
  console.log(JSON.stringify(rows, null, 2));
}
db.close();
