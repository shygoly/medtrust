#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MEDTRUST_WEB ?? 'https://web.szchada.top';
const API = process.env.MEDTRUST_API ?? 'https://api.szchada.top/api/v1';

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${body.message ?? text}`);
  return body;
}

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').trim())
    .filter(Boolean)
    .join('');
}

const captcha = await api('/auth/captcha');
const login = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    account: 'pv@demo-pharma.example',
    password: 'demo123456',
    captchaId: captcha.captchaId,
    captchaCode: captchaCode(captcha.image),
  }),
});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('medtrust_token', token);
      localStorage.setItem('medtrust_user', JSON.stringify(user));
      document.cookie = 'medtrust_space=sh-med; path=/';
    },
    { token: login.access_token, user: login.user },
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/space/assistant`, { waitUntil: 'networkidle' });
  await page.getByTestId('chat-input').fill('我想做单臂试验的外部对照，用于药物注册申请');
  await page.getByTestId('send-button').click();
  const form = page.locator('[data-card-type="form"]').last();
  await form.waitFor({ timeout: 60_000 });
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(ROOT, 'screenshots', '06-ai-form-card-r5.png'),
  });
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
  await page.screenshot({
    path: join(ROOT, 'screenshots', '07-ai-form-filled-r5.png'),
  });
} finally {
  await browser.close();
}
