#!/usr/bin/env node
/**
 * Capture RWS federated flow screenshots for docs/rws-federated-flow.html
 * Usage: node docs/demo/capture-rws-flow-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || path.join(__dirname, 'screenshots/rws-flow');
const WEB = process.env.WEB_URL || 'https://medtrust-web.fly.dev';
const API = process.env.API_URL || 'https://medtrust-api.fly.dev/api/v1';

async function login(page, label) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: label }).click();
  await page.waitForURL(/\/space/, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true });
  console.log('✓', name);
  return p;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Step 0 / architecture — login overview
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await shot(page, '00-architecture-login.png');

  // Step 1 — data prep (terminal panel rendered in page)
  const step1Html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0b0f14;color:#e8eef6;font-family:ui-monospace,Menlo,monospace;padding:24px}
    .bar{background:#121820;border:1px solid #243044;border-radius:12px;padding:16px 20px}
    h2{font-family:sans-serif;color:#3dd6c6;font-size:14px;margin:0 0 12px}
    pre{margin:0;font-size:13px;line-height:1.6;color:#b8d4ff}
    .ok{color:#4ade80}
  </style></head><body><div class="bar"><h2>步骤 1 · 准备本地演示数据</h2>
  <pre>$ pnpm split-synthea
<span class="ok">→ data/synthea/hospitals/demohospb/fhir/  (59 bundles)</span>
$ pnpm ingest-synthea
<span class="ok">→ data/synthea/connectors/demohospb/  (59 patients)</span>
$ ls data/synthea/connectors/demohospb | head -3
patient-7bbaa47e-d029-bf4f-3237-ddd955c0a584.json
patient-7d263602-8092-d0dc-3a46-995f0d6ddb33.json
patient-7d32ac44-4e37-67f0-6986-47eb18194f8e.json</pre></div></body></html>`;
  await page.setContent(step1Html);
  await shot(page, '01-data-prep.png');

  // Step 2 — catalog (示范甲 provider — 示范乙未在登录页，Fly 种子数据 p-demohospa)
  await login(page, '示范甲医院');
  await page.goto(`${WEB}/space/catalog`, { waitUntil: 'networkidle' });
  await shot(page, '02-catalog.png');

  // Step 3 — contracts
  await page.goto(`${WEB}/space/contracts`, { waitUntil: 'networkidle' });
  await shot(page, '03-contracts.png');

  // Step 4 — new RWS task (consumer)
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await login(page, '研究院');
  await page.goto(`${WEB}/space/tasks/new`, { waitUntil: 'networkidle' });
  await shot(page, '04-rws-task-new.png');

  // Submit a cohort-count task for screenshot of step 7
  const token = await page.evaluate(() => localStorage.getItem('medtrust_token'));
  const contractsRes = await fetch(`${API}/contracts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contracts = await contractsRes.json();
  const active = contracts.find(
    (c) => c.status === 'active' && c.providerId === 'p-demohospa',
  );
  let taskId = '';
  if (active) {
    const submitRes = await fetch(`${API}/rws/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'RWS 流程截图演示',
        purpose: active.purpose,
        analysis: { type: 'cohort-count' },
        contractIds: [active.id],
      }),
    });
    const submitted = await submitRes.json();
    taskId = submitted.taskId;
    console.log('submitted task', taskId);
    await page.waitForTimeout(8000);
  }

  // Step 5 — API pending (render response panel)
  const pendingRes = await fetch(
    `${API}/connector/rws/pending?participantId=p-demohospa`,
    {
      headers: {
        'X-Connector-Token': 'dev-connector-token',
        'X-Connector-Participant': 'p-demohospa',
      },
    },
  );
  const pendingJson = await pendingRes.json();
  const step5Html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0b0f14;color:#e8eef6;font-family:ui-monospace,Menlo,monospace;padding:24px}
    .bar{background:#121820;border:1px solid #243044;border-radius:12px;padding:16px 20px}
    h2{font-family:sans-serif;color:#3dd6c6;font-size:14px;margin:0 0 8px}
    .sub{font-family:sans-serif;color:#8fa3b8;font-size:12px;margin-bottom:12px}
    pre{margin:0;font-size:12px;line-height:1.5;color:#b8d4ff;white-space:pre-wrap}
  </style></head><body><div class="bar"><h2>步骤 5 · 连接器出站拉取</h2>
  <div class="sub">GET /api/v1/connector/rws/pending · medtrust-rws-worker-a 每 5s 轮询</div>
  <pre>${JSON.stringify(pendingJson, null, 2).replace(/</g, '&lt;')}</pre></div></body></html>`;
  await page.setContent(step5Html);
  await shot(page, '05-connector-pull.png');

  // Step 6 — progress timeline from task API
  let taskDetail = null;
  if (taskId) {
    const detailRes = await fetch(`${API}/rws/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    taskDetail = await detailRes.json();
  }
  const progress = taskDetail?.assignments?.[0]?.progress ?? [];
  const step6Html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0b0f14;color:#e8eef6;font-family:sans-serif;padding:24px}
    .bar{background:#121820;border:1px solid #243044;border-radius:12px;padding:16px 20px}
    h2{color:#3dd6c6;font-size:14px;margin:0 0 12px}
    .tl{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
    .t{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid #243044;color:#9ec5ff}
    .t.done{border-color:#1f4d3a;color:#4ade80}
    pre{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#b8d4ff;white-space:pre-wrap}
  </style></head><body><div class="bar"><h2>步骤 6 · 本地执行流水线（数据不出域）</h2>
  <div class="tl">${['catalog-prefetch', 'data-load', 'pep-check', 'compute', 'output-gate', 'retention', 'complete']
    .map((s) => `<span class="t ${progress.some((p) => p.stage === s) ? 'done' : ''}">${s}</span>`)
    .join('')}</div>
  <pre>${JSON.stringify(progress, null, 2).replace(/</g, '&lt;')}</pre></div></body></html>`;
  await page.setContent(step6Html);
  await shot(page, '06-local-pipeline.png');

  // Step 7 — task detail page
  if (taskId) {
    await page.goto(`${WEB}/space/tasks/${taskId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, '07-task-result.png');
  } else {
    await page.goto(`${WEB}/space/tasks`, { waitUntil: 'networkidle' });
    await shot(page, '07-task-result.png');
  }

  // API docs snippet
  await page.goto(`${API.replace('/api/v1', '')}/api/docs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, '08-api-docs.png');

  await browser.close();
  await writeFile(
    path.join(OUT, 'manifest.json'),
    JSON.stringify({ web: WEB, api: API, taskId, capturedAt: new Date().toISOString() }, null, 2),
  );
  console.log('done →', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
