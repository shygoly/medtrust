#!/usr/bin/env node
/**
 * 对话接口的本地压测冒烟（tasks 4.1.5）。
 *
 * 用法：node scripts/perf-smoke.mjs [baseUrl] [concurrency] [requests] [p95BudgetMs]
 *
 * 注意两点，避免把结果读成生产指标：
 * 1. 这里量的是**本机 rule-based 模式**（无 LLM 往返）的端到端 HTTP 耗时——
 *    对外部 LLM 的延迟不作任何声明；真实 P95 必须带供应商一起测。
 * 2. 压测前请把限流关掉（RATE_LIMIT_PER_USER_PER_MIN=0 RATE_LIMIT_PER_IP_PER_MIN=0），
 *    否则会量到 429 而不是耗时。
 */
const base = process.argv[2] ?? 'http://localhost:5032/api/v1';
const concurrency = Number(process.argv[3] ?? 20);
const requests = Number(process.argv[4] ?? 200);
const p95BudgetMs = Number(process.argv[5] ?? process.env.P95_BUDGET_MS ?? 2000);

const MESSAGES = [
  '我想做单臂试验的外部对照',
  '我想预测明天的电力负荷',
  '统计一下两院各年龄段的患病人数',
  '用联邦学习训练一个风险预测模型',
];

async function one(index) {
  const started = performance.now();
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': `perf-user-${index % 50}`,
      'x-space-id': 'sh-med',
    },
    body: JSON.stringify({ message: MESSAGES[index % MESSAGES.length] }),
  });
  const outcome = response.status;
  await response.text();
  return { ms: performance.now() - started, outcome };
}

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < requests) {
    const index = cursor;
    cursor += 1;
    results.push(await one(index));
  }
};

const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
const wallMs = performance.now() - startedAt;

const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const pick = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))];
const errors = results.filter((r) => r.outcome >= 400);

console.log('对话接口本地压测（rule-based 模式，无 LLM 往返）');
console.log(`  base=${base} concurrency=${concurrency} requests=${requests}`);
console.log(`  wall=${wallMs.toFixed(0)}ms throughput=${((requests / wallMs) * 1000).toFixed(1)} req/s`);
console.log(
  `  P50=${pick(0.5).toFixed(1)}ms P95=${pick(0.95).toFixed(1)}ms P99=${pick(0.99).toFixed(1)}ms max=${latencies[latencies.length - 1].toFixed(1)}ms`,
);
console.log(`  errors=${errors.length}（非 2xx：${[...new Set(errors.map((e) => e.outcome))].join(',') || '无'}）`);

if (errors.length > 0) {
  console.error('\n[FAIL] 存在非 2xx 响应；若为 429 请先关闭限流再压测。');
  process.exit(1);
}
if (pick(0.95) > p95BudgetMs) {
  console.error(`\n[FAIL] P95 ${pick(0.95).toFixed(1)}ms 超出预算 ${p95BudgetMs}ms。`);
  process.exit(1);
}
console.log(`\n[OK] P95 ${pick(0.95).toFixed(1)}ms ≤ 预算 ${p95BudgetMs}ms。`);
