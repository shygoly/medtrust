#!/usr/bin/env node

/** 浏览器级生产复测：统一入口 → 参数卡 → 提交 → 作业详情。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(ROOT, 'screenshots');
const BASE = process.env.MEDTRUST_WEB ?? 'https://web.szchada.top';
const API = process.env.MEDTRUST_API ?? 'https://api.szchada.top/api/v1';
const OUTPUT = join(ROOT, 'data', 'ui-preflight-r5.json');
mkdirSync(SHOTS, { recursive: true });

async function captchaCode(page) {
  return page.evaluate(() => {
    const image = document.querySelector('img[alt="图形验证码"]');
    const source = image?.getAttribute('src') ?? '';
    const encoded = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
    const svg = atob(encoded);
    return [...svg.matchAll(/>([^<>]{1,8})</g)]
      .map((match) => match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').trim())
      .filter(Boolean)
      .join('');
  });
}

async function api(path, init, token) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${body.message ?? text}`);
  return body;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#account').fill('pv@demo-pharma.example');
  await page.locator('#password').fill('demo123456');
  await page.locator('#captcha').fill(await captchaCode(page));
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/space'), { timeout: 60_000 }),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  await page.getByTestId('global-ai-entry').waitFor();
  await page.screenshot({ path: join(SHOTS, '05-ai-global-entry-r5.png') });

  await page.goto(`${BASE}/space/assistant`, { waitUntil: 'networkidle' });
  await page.getByTestId('chat-input').fill('我想做单臂试验的外部对照，用于药物注册申请');
  await page.getByTestId('send-button').click();
  const form = page.locator('[data-card-type="form"]').last();
  await form.waitFor({ timeout: 60_000 });
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, '06-ai-form-card-r5.png') });

  for (const [name, value] of [
    ['trial', 'p-huashan'],
    ['trialDataProduct', '40ff788a-89e7-4601-9981-9b9b962d509e'],
    ['controls', 'p-ruijin'],
    ['controlsDataProduct', '99bd8b08-6a69-457f-8063-2bde919ea413'],
  ]) {
    await form.locator(`select[name="${name}"]`).selectOption(value);
  }
  await form.locator('[name="strataKeys"]').fill(
    '18-39|M, 18-39|F, 40-64|M, 40-64|F',
  );
  await form.locator('[name="teeNode"]').fill(
    'urn:tds:sh-med:participant:tee-node-a',
  );
  await form.locator('[name="caliperDays"]').fill('30');
  await form.locator('[name="ratioK"]').fill('2');
  await page.screenshot({ path: join(SHOTS, '07-ai-form-filled-r5.png') });

  await form.locator('[data-testid="submit-card"]').click();
  const status = page.locator('[data-card-type="status"][data-job-id]').last();
  await status.waitFor({ timeout: 60_000 });
  const jobId = await status.getAttribute('data-job-id');
  if (!jobId) throw new Error('状态卡没有作业号');
  await status.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, '08-ai-submitted-r5.png') });

  const token = await page.evaluate(() => localStorage.getItem('medtrust_token'));
  if (!token) throw new Error('浏览器登录态缺少 access token');
  const compile = await api(
    `/mdop/jobs/${encodeURIComponent(jobId)}/compile`,
    { method: 'POST', body: '{}' },
    token,
  );
  let detail;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    detail = await api(`/mdop/jobs/${encodeURIComponent(jobId)}`, {}, token);
    const job = detail.job ?? detail;
    console.log(`${new Date().toISOString()} ${jobId} ${job.status}`);
    if (['PURGED', 'FAILED', 'REJECTED', 'ABORTED'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if ((detail?.job ?? detail)?.status === 'PURGED') {
    await api(`/mdop/jobs/${encodeURIComponent(jobId)}/anchor`, {
      method: 'POST',
      body: '{}',
    }, token);
    detail = await api(`/mdop/jobs/${encodeURIComponent(jobId)}`, {}, token);
  }

  await page.goto(`${BASE}/space/mdop/jobs/${encodeURIComponent(jobId)}`, {
    waitUntil: 'networkidle',
  });
  await page.screenshot({ path: join(SHOTS, '09-ai-job-overview-r5.png') });
  const resultTitle = page.getByText('合并结果（C3 交付物）与发布审查').first();
  if (await resultTitle.count()) {
    await resultTitle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, '10-ai-job-result-r5.png') });
  }
  writeFileSync(
    OUTPUT,
    JSON.stringify({ base: BASE, api: API, jobId, compile, detail }, null, 2),
  );
} finally {
  await browser.close();
}
