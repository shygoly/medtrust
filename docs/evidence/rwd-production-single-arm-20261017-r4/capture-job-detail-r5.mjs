#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MEDTRUST_WEB ?? 'https://web.szchada.top';
const API = process.env.MEDTRUST_API ?? 'https://api.szchada.top/api/v1';
const JOB = process.env.MEDTRUST_JOB ?? 'job-mvcz4ql3-b8500522';

function captchaCode(image) {
  const encoded = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  return [...svg.matchAll(/>([^<>]{1,8})</g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .join('');
}
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
  await page.goto(`${BASE}/space/mdop/jobs/${JOB}`, { waitUntil: 'networkidle' });
  await page.screenshot({
    path: join(ROOT, 'screenshots', '09-ai-job-overview-r5.png'),
  });
  const bundle = page.getByText('ContractBundle 与成员绑定').first();
  await bundle.waitFor({ timeout: 30_000 });
  await bundle.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(ROOT, 'screenshots', '13-contract-bundle-detail-r5.png'),
  });
  const result = page.getByText('合并结果（C3 交付物）与发布审查').first();
  if (await result.count()) {
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(ROOT, 'screenshots', '10-ai-job-result-r5.png'),
    });
  }
} finally {
  await browser.close();
}
