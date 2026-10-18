import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mac/.agents/skills/gstack/node_modules/playwright');
const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:5080';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('CONSOLE ERROR', message.text());
});
page.on('requestfailed', (request) => {
  console.log('REQUEST FAILED', request.method(), request.url(), request.failure()?.errorText);
});
page.on('response', async (response) => {
  if (response.status() >= 400) {
    console.log('HTTP ERROR', response.status(), response.url());
  }
});

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('#account').waitFor();
await page.locator('img[alt="图形验证码"]').waitFor({ timeout: 30_000 });
const code = await page.evaluate(() => {
  const image = document.querySelector('img[alt="图形验证码"]');
  const source = image?.getAttribute('src') ?? '';
  const encoded = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
  const svg = atob(encoded);
  return [...svg.matchAll(/>([^<>]{1,8})</g)].map((m) => m[1].trim()).filter(Boolean).join('');
});
await page.locator('#account').fill('pv@demo-pharma.example');
await page.locator('#password').fill('demo123456');
await page.locator('#captcha').fill(code);
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForURL((url) => url.pathname.startsWith('/space'), { timeout: 60_000 });
await page.goto(`${BASE}/space/chat`, { waitUntil: 'networkidle' });
await page.getByTestId('chat-input').fill('我想做单臂试验的外部对照');
await page.getByTestId('send-button').click();
await page.waitForTimeout(20_000);
await page.screenshot({
  path: join(ROOT, 'screenshots', '06-agent-response-debug.png'),
  fullPage: false,
});
const messages = await page.locator('[data-role]').allTextContents();
const cards = await page.locator('[data-card-type]').evaluateAll((elements) =>
  elements.map((element) => ({
    type: element.getAttribute('data-card-type'),
    title: element.getAttribute('data-card-title'),
    text: element.textContent?.slice(0, 1200),
  })),
);
console.log(JSON.stringify({ messages, cards }, null, 2));
await browser.close();
