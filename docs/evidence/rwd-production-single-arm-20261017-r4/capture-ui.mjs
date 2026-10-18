#!/usr/bin/env node

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(ROOT, 'screenshots');
const BASE = 'http://127.0.0.1:5080';
const JOB = 'job-mvcistch-02862d64';
const VIEWPORT = { width: 1440, height: 1000 };

const PHARMA = {
  account: 'pv@demo-pharma.example',
  password: 'demo123456',
  label: 'pharma',
};
const HUASHAN = {
  account: 'admin@huashan-hospital.com',
  password: 'demo123456',
  label: 'huashan',
};
const RUIJIN = {
  account: 'admin@rjh.com.cn',
  password: 'demo123456',
  label: 'ruijin',
};

async function captchaCode(page) {
  return page.evaluate(() => {
    const image = document.querySelector('img[alt="图形验证码"]');
    if (!image) throw new Error('captcha image not found');
    const source = image.getAttribute('src') ?? '';
    const encoded = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
    const svg = atob(encoded);
    return [...svg.matchAll(/>([^<>]{1,8})</g)]
      .map((match) =>
        match[1]
          .replaceAll('&amp;', '&')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .trim(),
      )
      .filter(Boolean)
      .join('');
  });
}

async function loginAs(browser, user) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#account').waitFor({ state: 'visible' });
  await page.locator('img[alt="图形验证码"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#account').fill(user.account);
  await page.locator('#password').fill(user.password);
  const code = await captchaCode(page);
  await page.locator('#captcha').fill(code);
  await page.locator('button[title="显示密码"]').click();
  await page.screenshot({
    path: join(SHOTS, `01-login-${user.label}-filled.png`),
    fullPage: false,
  });
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/space'), { timeout: 60_000 }),
    page.getByRole('button', { name: '登录', exact: true }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: join(SHOTS, `02-login-${user.label}-success.png`),
    fullPage: false,
  });
  return { context, page };
}

async function scrollAndShot(page, text, filename) {
  const target = page.getByText(text, { exact: false }).first();
  await target.waitFor({ state: 'visible', timeout: 30_000 });
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, filename), fullPage: false });
}

const browser = await chromium.launch({ headless: true });
try {
  const pharma = await loginAs(browser, PHARMA);
  const page = pharma.page;

  await page.goto(`${BASE}/space/catalog`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(SHOTS, '03-data-catalog.png'), fullPage: false });
  await scrollAndShot(page, '单臂试验受试者数据', '03a-trial-dataset.png');
  await scrollAndShot(page, '真实世界历史对照池', '03b-control-dataset.png');

  await page.goto(`${BASE}/space/contracts`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(SHOTS, '04-contracts.png'), fullPage: false });
  await scrollAndShot(page, '已生效', '04a-contract-active.png');

  await page.goto(`${BASE}/space/chat`, { waitUntil: 'networkidle' });
  await page.getByTestId('chat-input').fill('我想做单臂试验的外部对照，用于药物注册申请');
  await page.screenshot({ path: join(SHOTS, '05-chat-prompt.png'), fullPage: false });
  await page.getByTestId('send-button').click();
  await page.locator('[data-card-type]').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('[data-card-type]').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, '06-agent-contract-gate.png'), fullPage: false });

  await page.goto(`${BASE}/space/mdop/jobs/${JOB}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(SHOTS, '07-job-overview.png'), fullPage: false });
  await scrollAndShot(page, '阶段（各节点）', '08-job-stages.png');
  await scrollAndShot(page, '执行凭证', '09-job-ticket.png');
  await scrollAndShot(page, '会话证明与本院核验', '10-job-witness.png');
  await scrollAndShot(page, '合并结果（C3 交付物）与发布审查', '11-job-result.png');
  await scrollAndShot(page, '发布审查', '12-job-release-review.png');

  await page.goto(`${BASE}/space/tasks?channel=mdop`, { waitUntil: 'networkidle' });
  await page.getByText(JOB, { exact: false }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, '13-job-in-task-list.png'), fullPage: false });
  await pharma.context.close();

  const huashan = await loginAs(browser, HUASHAN);
  await huashan.page.goto(`${BASE}/space/contracts`, { waitUntil: 'networkidle' });
  await huashan.page.screenshot({
    path: join(SHOTS, '14-huashan-contracts.png'),
    fullPage: false,
  });
  await huashan.context.close();

  const ruijin = await loginAs(browser, RUIJIN);
  await ruijin.page.goto(`${BASE}/space/contracts`, { waitUntil: 'networkidle' });
  await ruijin.page.screenshot({
    path: join(SHOTS, '15-ruijin-contracts.png'),
    fullPage: false,
  });
  await ruijin.context.close();
} finally {
  await browser.close();
}
