// omop-data-source-access 8.4 —— 对比「底表 / 只裁列视图 / 裁列 + 行级过滤视图」三种读法：
// 规划器是否仍用索引、耗时差多少。由 omop-view-benchmark.sh 起库灌数后调用。
//
//   BENCH_DATABASE_URL=postgres://postgres:admin@127.0.0.1:5029/bench node omop-view-benchmark.mjs
import pg from 'pg';

const url = process.env.BENCH_DATABASE_URL;
if (!url) {
  console.error('需要 BENCH_DATABASE_URL');
  process.exit(2);
}

const SCHEMAS = ['omop', 'v_plain', 'v_filtered'];
const RUNS = 5;

// 代表性查询：队列入组（按药物概念取首次暴露）、暴露后 30 天内结局、按人点查、按人判暴露。
const QUERIES = {
  'Q1 队列入组（药物概念 → 首次暴露）': (s) =>
    `SELECT person_id, min(drug_exposure_start_date) AS index_date
     FROM ${s}.drug_exposure WHERE drug_concept_id = 42 GROUP BY person_id`,
  'Q2 暴露后 30 天内结局': (s) =>
    `WITH exposed AS (
       SELECT person_id, min(drug_exposure_start_date) AS index_date
       FROM ${s}.drug_exposure WHERE drug_concept_id = 42 GROUP BY person_id)
     SELECT count(DISTINCT e.person_id) FROM exposed e
     JOIN ${s}.condition_occurrence co
       ON co.person_id = e.person_id AND co.condition_concept_id = 77
      AND co.condition_start_date BETWEEN e.index_date AND e.index_date + 30`,
  'Q3 按人点查': (s) => `SELECT * FROM ${s}.person WHERE person_id = 123457`,
  'Q4 某人是否暴露（投影里的 EXISTS 形态）': (s) =>
    `SELECT p.person_id, EXISTS (
       SELECT 1 FROM ${s}.drug_exposure de
       WHERE de.person_id = p.person_id AND de.drug_concept_id = ANY('{42,43}'::int[])) AS exposed
     FROM ${s}.person p WHERE p.person_id BETWEEN 500000 AND 500999`,
};

function walk(node, out) {
  out.push(node['Node Type'] + (node['Index Name'] ? `(${node['Index Name']})` : ''));
  for (const child of node.Plans ?? []) walk(child, out);
  return out;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const rows = [];
for (const [name, sql] of Object.entries(QUERIES)) {
  for (const schema of SCHEMAS) {
    const times = [];
    let nodes = [];
    for (let i = 0; i < RUNS; i += 1) {
      const res = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql(schema)}`);
      const plan = res.rows[0]['QUERY PLAN'][0];
      times.push(plan['Execution Time']);
      nodes = walk(plan.Plan, []);
    }
    times.sort((a, b) => a - b);
    const indexNodes = [...new Set(nodes.filter((n) => /Index/.test(n)))];
    rows.push({ name, schema, medianMs: times[Math.floor(RUNS / 2)], indexNodes });
  }
}
await client.end();

for (const name of Object.keys(QUERIES)) {
  console.log(`\n${name}`);
  const base = rows.find((r) => r.name === name && r.schema === 'omop').medianMs;
  for (const r of rows.filter((x) => x.name === name)) {
    const ratio = (r.medianMs / base).toFixed(2);
    console.log(
      `  ${r.schema.padEnd(11)} 中位 ${r.medianMs.toFixed(1).padStart(9)} ms  (×${ratio})  索引: ${
        r.indexNodes.join(', ') || '—（顺序扫描）'
      }`,
    );
  }
}
