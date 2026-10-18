const Database = require('better-sqlite3');

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error('contract ids required');
const db = new Database('/repo/apps/connector/data/connector-local.db', {
  readonly: true,
});
const statement = db.prepare(
  'SELECT * FROM local_mdop_contract WHERE contractId = ?',
);
for (const id of ids) {
  const row = statement.get(id);
  if (!row) {
    console.log(JSON.stringify({ id, missing: true }, null, 2));
    continue;
  }
  console.log(JSON.stringify({
    contractId: row.contractId,
    status: row.status,
    purposeCode: row.purposeCode,
    allowedOpDigests: JSON.parse(row.allowedOpDigests || '[]'),
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    canonical: JSON.parse(row.canonical),
  }, null, 2));
}
db.close();
