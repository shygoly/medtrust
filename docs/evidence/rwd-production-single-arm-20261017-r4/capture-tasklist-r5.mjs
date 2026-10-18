#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MEDTRUST_WEB ?? 'https://web.szchada.top';
const JOB = process.env.MEDTRUST_JOB ?? 'job-mvcz4ql3-b8500522';

async function captchaCode(page) {
  return page.evaluate(() => {
    const source = document.querySelector('img[alt="图形验证码"]')?.getAttribute('src') ?? '';
    const encoded = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
    const svg = atob(encoded);
    return [...svg.matchAll(/>([^<>]{1,8})</g)]
      .map((match) => match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').trim())
      .filter(Boolean)
      .join('');
  });
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
  await page.goto(`${BASE}/space/tasks?channel=mdop`, { waitUntil: 'networkidle' });
  const row = page.getByText(JOB, { exact: false }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(ROOT, 'screenshots', '12-task-list-r5.png'),
  });
} finally {
  await browser.close();
}
