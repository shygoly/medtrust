import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5020';
const RUN_DIR = resolve(
  process.env.REGISTRATION_SCREENSHOT_DIR ||
    'test-results/rwd-registration-report',
);
const ACCOUNT = {
  user: process.env.TEST_USER_ACCOUNT || 'pv@demo-pharma.example',
  password: process.env.TEST_USER_PASSWORD || 'demo123456',
  captcha: 'DEMO',
};
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const shots: Array<{
  stepId: string;
  title: string;
  file: string;
  sha256: string;
  toolName: string;
  backendResource: Record<string, string | number>;
}> = [];

async function capture(
  page: Page,
  stepId: string,
  title: string,
  toolName: string,
  backendResource: Record<string, string | number> = {},
  fullPage = false,
) {
  const name = `${stepId}.png`;
  const path = resolve(RUN_DIR, name);
  if (fullPage) await page.screenshot({ path, fullPage: true });
  else
    await page
      .locator('[data-role="assistant"]')
      .last()
      .screenshot({ path });
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  shots.push({ stepId, title, file: `screenshots/${name}`, sha256, toolName, backendResource });
}

async function stub(page: Page) {
  await page.route('http://localhost:5021/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/captcha')) {
      await route.fulfill({
        json: { captchaId: 'demo-captcha', image: TINY_PNG, expiresInSeconds: 300 },
      });
      return;
    }
    if (url.includes('/auth/login')) {
      await route.fulfill({
        json: {
          user: {
            id: 42,
            email: ACCOUNT.user,
            name: '创新药企 · 使用方',
            role: 'consumer',
            participantId: 'p-sponsor',
          },
          access_token: 'demo-access-token',
          refresh_token: 'demo-refresh-token',
        },
      });
      return;
    }
    if (url.includes('/auth/profile') || url.includes('/auth/me')) {
      await route.fulfill({
        json: {
          userId: 42,
          email: ACCOUNT.user,
          participantId: 'p-sponsor',
          role: 'consumer',
          spaces: ['sh-med'],
          spaceId: 'sh-med',
        },
      });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.addInitScript(() => {
    document.cookie = 'medtrust_space=sh-med; path=/';
  });
}

async function send(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('chat-progress')).toBeHidden({ timeout: 30_000 });
}

async function continueCard(page: Page, title: string) {
  const card = page
    .locator(`[data-card-type="confirm"][data-card-title*="${title}"]`)
    .last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.locator('[data-testid="submit-card"]').click();
}

test('A01–A10：登录后仅通过 AI 助手完成注册研究与报告下载', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(resolve(RUN_DIR, 'screenshots'), { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stub(page);

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#account', ACCOUNT.user);
  await page.fill('#password', ACCOUNT.password);
  await page.fill('#captcha', ACCOUNT.captcha);
  await capture(
    page,
    'A01',
    '登录页与虚构演示凭据',
    'auth_session',
    { account: ACCOUNT.user },
    true,
  );
  await page.locator('button[type="submit"]').first().click();
  await page.locator('button[title="退出登录"]').waitFor({ timeout: 20_000 });

  await page.goto(
    `${BASE_URL}/space/assistant`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });
  await send(page, '创建一项单臂外部对照注册研究并生成模拟报告');
  const form = page.locator('[data-card-type="form"]').last();
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form).toHaveAttribute('data-card-title', /A02/);

  for (const [name, value] of [
    ['studyId', 'REG-ECA-001'],
    ['product', 'SIM-MAB-01'],
    ['indication', 'SIM-DERM-01'],
    ['profileVersion', 'registration-eca/1.0.0'],
    ['protocolVersion', 'protocol-1'],
    ['sapVersion', 'sap-1'],
    ['timeZero', 'treatment-start'],
    ['outcome', 'week-24-response'],
    ['contractBundleId', 'bundle-reg-e2e'],
    ['contractBundleVersion', 'v1'],
  ] as const)
    await page.fill(`[name="${name}"]`, value);
  await page.selectOption('[name="trial"]', 'p-sponsor');
  await page.selectOption('[name="trialDataProduct"]', 'dp-trial');
  await page.selectOption('[name="primaryControl"]', 'p-hosp-a');
  await page.selectOption('[name="primaryControlDataProduct"]', 'dp-controls');
  await capture(page, 'A02', '注册研究草稿卡', 'draft_registration_study', {
    studyId: 'REG-ECA-001',
  });
  await form.locator('[data-testid="submit-card"]').click();

  const stepTitles = [
    ['A03', 'Profile 已通过校验', 'validate_registration_profile'],
    ['A04', '数据源与合约已解析', 'resolve_registration_sources'],
    ['A05', '统计与执行计划待确认', 'review_registration_plan'],
    ['A06', '合成数据演练已准备', 'prepare_synthetic_registration'],
  ] as const;
  for (const [stepId, title, tool] of stepTitles) {
    const card = page
      .locator(`[data-card-type="confirm"][data-card-title*="${title}"]`)
      .last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await capture(page, stepId, title, tool, { studyId: 'REG-ECA-001' });
    await continueCard(page, title);
  }

  const submitted = page
    .locator('[data-card-type="status"][data-job-id]')
    .last();
  await expect(submitted).toBeVisible({ timeout: 30_000 });
  const jobId = await submitted.getAttribute('data-job-id');
  expect(jobId).toBeTruthy();
  await capture(page, 'A07', '提交注册研究作业', 'submit_external_control_registration', {
    jobId: jobId!,
  });

  await send(page, '查询注册研究任务状态');
  await expect(page.locator('[data-card-type="status"]').last()).toContainText('A08');
  await capture(page, 'A08', '查询作业状态', 'get_registration_job', { jobId: jobId! });

  await send(page, '生成模拟注册研究报告');
  await expect(page.locator('[data-card-type="result"]').last()).toContainText('A09');
  await capture(page, 'A09', '生成注册研究报告', 'build_registration_report', {
    jobId: jobId!,
  });

  await send(page, '下载模拟注册研究报告和证据包');
  const download = page.locator('[data-card-type="result"]').last();
  await expect(download).toContainText('A10');
  await expect(download).toContainText('SIMULATION ONLY');
  await capture(page, 'A10', '下载报告与证据包', 'download_registration_report', {
    jobId: jobId!,
  });

  expect(page.url()).toContain('/space/assistant');
  expect(page.url()).not.toContain('/space/tasks/new/registration');
  expect(shots.map((shot) => shot.stepId)).toEqual([
    'A01',
    'A02',
    'A03',
    'A04',
    'A05',
    'A06',
    'A07',
    'A08',
    'A09',
    'A10',
  ]);
  writeFileSync(
    resolve(RUN_DIR, 'screenshot-manifest.json'),
    JSON.stringify(
      {
        schema: 'medtrust.rwd-registration-screenshots/v1',
        syntheticOnly: true,
        sessionId: 'registration-e2e-session',
        viewport: { width: 1920, height: 1080 },
        screenshots: shots,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
});
