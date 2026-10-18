import { test, expect, type Page } from '@playwright/test';

const USER = {
  id: 42,
  email: 'e2e-consumer@medtrust.test',
  name: 'E2E 使用方',
  role: 'consumer' as const,
  participantId: 'p-sponsor',
};

const PROFILE = {
  userId: USER.id,
  email: USER.email,
  participantId: USER.participantId,
  role: USER.role,
  spaces: ['sh-med'],
  spaceId: 'sh-med',
};

/**
 * 登录态与上游控制面都在浏览器侧预置：
 * - localStorage 里的 token + user 让 AuthGate 放行（真实 chat-agent 仍会收到这两个头）；
 * - 5021（控制面 API）用 route 挡掉，返回本人 profile 与空目录——本次 E2E 只验
 *   浏览器 ↔ chat-agent 这一段，控制面另由桩（5099）在服务端承担。
 */
async function seedSession(page: Page, userId = USER.id) {
  await page.addInitScript(
    ([token, user]) => {
      localStorage.setItem('medtrust_token', token);
      localStorage.setItem('medtrust_user', JSON.stringify(user));
      document.cookie = 'medtrust_space=sh-med; path=/';
    },
    ['e2e-token', { ...USER, id: userId }] as const,
  );

  await page.route('http://localhost:5021/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/profile') || url.includes('/auth/me')) {
      await route.fulfill({ json: { ...PROFILE, userId } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

async function openChat(page: Page) {
  await page.goto('/space/chat');
  await expect(page.getByTestId('chat-input')).toBeVisible();
}

async function askForExternalControl(page: Page) {
  await page.getByTestId('chat-input').fill('我想做单臂试验的外部对照');
  await page.getByTestId('send-button').click();
  const card = page.locator('[data-card-type="form"]').last();
  await expect(card).toBeVisible();
  await expect(card).toContainText('外部对照');
  return card;
}

test.describe('对话式任务配置（浏览器级）', () => {
  test.beforeEach(async ({ page }) => {
    // 客户端异常一律打出来 + 收集起来断言，避免"页面白了"但没有原因。
    page.on('pageerror', (error) => {
      console.log('PAGEERROR', error.message, (error.stack ?? '').slice(0, 1200));
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.log('CONSOLE_ERROR', message.text().slice(0, 400));
      }
    });
    // 各用例自己做 seedSession（不同 userId，避免会话在用例间串）
  });

  test('单臂对照完整流程：出卡 → 填表 → 提交 → 任务 ID', async ({ page }) => {
    await seedSession(page, 4201);
    await openChat(page);
    const card = await askForExternalControl(page);

    // 下拉候选来自控制面目录（chat-agent 服务端拉取），不是前端编的
    await card.locator('select[name="trial"]').selectOption('p-sponsor');
    await card.locator('select[name="trialDataProduct"]').selectOption('dp-trial');
    await card.locator('select[name="controls"]').selectOption('p-hosp-a');
    await card.locator('select[name="controlsDataProduct"]').selectOption('dp-controls');
    await card.locator('input[name="strataKeys"]').fill('<40|M, 40+|F');

    // 前端走的是流式端点（/chat/stream）；两条路径都能接受，避免测试把实现细节钉死。
    const submitted = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && /\/api\/v1\/chat(\/stream)?$/.test(request.url()),
    );
    await card.getByTestId('submit-card').click();

    const status = page.locator('[data-card-type="status"]').last();
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-tone', 'success');
    await expect(status).toContainText('job-e2e-1');

    // 回灌的是 [card:submit] 信封，且带着表单值（前后端唯一契约）
    const envelope = (await submitted).postData() ?? '';
    expect(envelope).toContain('[card:submit]');
    expect(envelope).toContain('external-control');
    expect(envelope).toContain('p-hosp-a');
  });

  test('错误处理：提交被拒 → 失败卡 + 预填回卡（可改一处分再提交）', async ({ page }) => {
    await seedSession(page, 4202);
    await openChat(page);
    const card = await askForExternalControl(page);

    await card.locator('select[name="trial"]').selectOption('p-sponsor');
    await card.locator('select[name="trialDataProduct"]').selectOption('dp-trial');
    await card.locator('select[name="controls"]').selectOption('p-hosp-a');
    await card.locator('select[name="controlsDataProduct"]').selectOption('dp-controls');
    await card.locator('input[name="strataKeys"]').fill('FAIL');

    await card.getByTestId('submit-card').click();

    const errorCard = page.locator('[data-card-type="status"]').last();
    await expect(errorCard).toHaveAttribute('data-tone', 'error');
    await expect(errorCard).toContainText('control-plane rejected');

    const retry = page.locator('[data-card-type="form"]').last();
    await expect(retry).toContainText('修改后重新提交');
    // 填过的值回到卡片上
    await expect(retry.locator('select[name="trial"]')).toHaveValue('p-sponsor');
    await expect(retry.locator('input[name="strataKeys"]')).toHaveValue('FAIL');

    // 只改分层键即可再提交成功
    await retry.locator('input[name="strataKeys"]').fill('<40|F');
    await retry.getByTestId('submit-card').click();
    const success = page.locator('[data-card-type="status"]').last();
    await expect(success).toHaveAttribute('data-tone', 'success');
    await expect(success).toContainText('job-e2e-1');
  });

  test('会话管理：侧栏出现会话；「新会话」清空会话区', async ({ page }) => {
    await seedSession(page, 4203);
    await openChat(page);
    await askForExternalControl(page);

    const sidebar = page.getByTestId('session-rail');
    await expect(sidebar).toContainText('我想做单臂试验的外部对照');

    await sidebar.getByRole('button', { name: '新会话' }).click();
    await expect(page.locator('[data-card-type="form"]')).toHaveCount(0);
    await expect(page.getByTestId('message-list')).toContainText('用一句话说明你的数据与目标');
  });
});