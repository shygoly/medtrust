#!/usr/bin/env node
/**
 * 提交成功率冒烟（tasks 验收清单「任务提交成功率 > 99%」的**本地**那一半）。
 *
 * 用法：node scripts/submit-success-rate.mjs [baseUrl] [attempts] [concurrency]
 *
 * 说清楚它测到了什么、没测到什么：
 * - 测到：本服务端到端（识别 → 卡片 → 工具 → 控制面调用 → 状态卡）在受控上游下的成功率。
 *   上游是**桩**，所以这里排除的是"服务自身的提交链路缺陷"，不是生产上游的问题。
 * - 没测到：真实控制面/模板登记/权限与线上流量。生产口径必须用线上指标
 *   `chat_requests_total{outcome="success"}` 与任务表对账，脚本不能替代。
 *
 * 压测前请关掉限流（RATE_LIMIT_*_PER_MIN=0），否则会量到 429 而不是成功率。
 */
const base = process.argv[2] ?? 'http://localhost:5032/api/v1';
const attempts = Number(process.argv[3] ?? 200);
const concurrency = Number(process.argv[4] ?? 20);
const budgetPct = Number(process.env.SUBMIT_SUCCESS_BUDGET_PCT ?? 99);

const envelope = (index) =>
  '[card:submit] ' +
  JSON.stringify({
    kind: 'card-submit',
    cardType: 'form',
    title: '外部对照配置',
    scenario: 'external-control',
    values: {
      trial: 'p-sponsor',
      trialDataProduct: 'dp-trial',
      controls: 'p-hosp-a',
      controlsDataProduct: 'dp-controls',
      strataKeys: '<40|M',
    },
  });

async function attempt(index) {
  try {
    const response = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': `success-rate-${index % 25}`,
        'x-space-id': 'sh-med',
      },
      body: JSON.stringify({ message: envelope(index) }),
    });
    const body = await response.json().catch(() => ({}));
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    const status = cards.find((card) => card?.type === 'status');
    const jobId = status?.data?.jobId;
    return { ok: response.ok && Boolean(jobId), http: response.status, jobId };
  } catch (error) {
    return { ok: false, http: 0, error: error instanceof Error ? error.message : 'unknown' };
  }
}

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < attempts) {
    const index = cursor;
    cursor += 1;
    results.push(await attempt(index));
  }
};
const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, attempts) }, worker));
const elapsedMs = performance.now() - startedAt;

const succeeded = results.filter((r) => r.ok).length;
const rate = (succeeded / results.length) * 100;
const byHttp = results.reduce((acc, r) => ({ ...acc, [r.http]: (acc[r.http] ?? 0) + 1 }), {});

console.log('提交成功率（本地桩上游）');
console.log(`  base=${base} attempts=${attempts} concurrency=${concurrency} 用时=${elapsedMs.toFixed(0)}ms`);
console.log(`  成功（HTTP 2xx 且拿到 jobId）=${succeeded}/${results.length} = ${rate.toFixed(2)}%`);
console.log(`  按 HTTP 状态分布：${JSON.stringify(byHttp)}`);

if (rate < budgetPct) {
  console.error(`\n[FAIL] 成功率 ${rate.toFixed(2)}% 低于预算 ${budgetPct}%。`);
  process.exit(1);
}
console.log(`\n[OK] 成功率 ${rate.toFixed(2)}% ≥ 预算 ${budgetPct}%。`);
