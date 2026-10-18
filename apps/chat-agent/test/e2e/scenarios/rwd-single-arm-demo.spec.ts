import { test, expect, Page } from '@playwright/test';

/**
 * RWD 单臂药物注册场景 E2E 演示（浏览器级）
 *
 * 场景：某药企想用真实世界数据（RWD）作外部对照，与单臂试验组比较，用于药物注册申请。
 *
 * 1. 登录系统            5. 填写试验方 / 对照方 / 分层键等参数
 * 2. 进入 AI Chat Agent  6. 提交任务，拿到作业号
 * 3. 用自然语言提出需求   7. 查看任务状态卡片
 * 4. Agent 返回配置表单   8.（另一条用例）参数校验失败时的错误提示
 *
 * 三条链路里两段是真的，一段是桩：
 *   浏览器 ──真──▶ apps/web（:5020，生产构建 next start）
 *   浏览器 ──真──▶ apps/chat-agent（:5032，rule-based 模式，无需 LLM key）
 *   chat-agent ──桩──▶ 控制面 API（:5099，见 test/stub-control-plane.mjs）
 * 登录用的控制面（:5021）也在**浏览器侧打桩**（见 stubControlPlane）：本演示要验的是
 * 「浏览器 → web → chat-agent → 控制面桩」这条业务链，而不是认证后端。
 */

const TEST_CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:5020',
  chatAgentUrl: process.env.CHAT_AGENT_URL || 'http://localhost:5032',
  testUser: {
    // 与 apps/web/src/app/login/page.tsx 的 DEMO_ACCOUNTS 同源。
    // **需求方 = 药企（使用方）**：单臂外部对照是药企的注册研究诉求；
    // 医院是数据提供方，只负责上架数据/签发合约（见 contract-compliance-flow.spec.ts）。
    account: process.env.TEST_USER_ACCOUNT || 'pv@demo-pharma.example',
    password: process.env.TEST_USER_PASSWORD || 'demo123456',
  },
  // 取值必须来自**目录里有**的参与方/数据产品（桩见 test/stub-control-plane.mjs）
  testData: {
    trial: { participantId: 'p-sponsor', dataProductId: 'dp-trial' },
    controls: { participantId: 'p-hosp-a', dataProductId: 'dp-controls' },
    strataKeys: ['<40|M', '40-60|M', '>60|M', '<40|F', '40-60|F', '>60|F'],
    caliperDays: 30,
    ratioK: 2,
  },
  timeout: {
    login: 15_000,
    navigation: 15_000,
    agentResponse: 20_000,
    taskSubmit: 25_000,
  },
};

/** 1×1 透明 PNG：验证码 <img> 需要有 src，但演示不依赖真实图形。 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const DEMO_USER = {
  id: 42,
  email: TEST_CONFIG.testUser.account,
  // 药企（申办方）发起研究；participantId 对齐 fixture 里的申办方参与方。
  name: '创新药企 · 使用方',
  role: 'consumer' as const,
  participantId: 'p-sponsor',
};

/**
 * 登录 + 控制面都在浏览器侧预置。
 *
 * 为什么能这么干：`useAuth()` 读的是 localStorage（token + user），AuthGate 再拿 token
 * 调 `/auth/profile`。所以只要把这几个端点挡在浏览器侧，登录页面走的仍是**真实**流程
 * （填表 → 校验 → saveSession → router.push），无需拉起 apps/api 与本机数据库。
 */
async function stubControlPlane(page: Page): Promise<void> {
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
          user: DEMO_USER,
          access_token: 'demo-access-token',
          refresh_token: 'demo-refresh-token',
        },
      });
      return;
    }
    if (url.includes('/auth/profile') || url.includes('/auth/me')) {
      await route.fulfill({
        json: {
          userId: DEMO_USER.id,
          email: DEMO_USER.email,
          participantId: DEMO_USER.participantId,
          role: DEMO_USER.role,
          spaces: ['sh-med'],
          spaceId: 'sh-med',
        },
      });
      return;
    }
    // 控制台的其它读接口：返回空列表，避免演示被无关数据干扰
    await route.fulfill({ json: [] });
  });

  // 空间上下文（chat-agent 的 x-space-id 头来自这个 cookie）
  await page.addInitScript(() => {
    document.cookie = 'medtrust_space=sh-med; path=/';
  });
}

async function scrollIntoView(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => undefined);
}

/** 登录并断言真的进了控制台（判据是侧栏的「退出登录」按钮，不是文案）。 */
async function login(page: Page): Promise<void> {
  await page.goto(`${TEST_CONFIG.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#account').waitFor({ timeout: TEST_CONFIG.timeout.login });
  await page.fill('#account', TEST_CONFIG.testUser.account);
  await page.fill('#password', TEST_CONFIG.testUser.password);
  await page.fill('#captcha', 'DEMO');
  await page.locator('button[type="submit"]').first().click();
  await page.locator('button[title="退出登录"]').waitFor({ timeout: TEST_CONFIG.timeout.login });
}

/** 进入 AI 助手页（真实路由是 /space/chat）。 */
async function openChat(page: Page): Promise<void> {
  await page.goto(`${TEST_CONFIG.baseUrl}/space/chat`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: TEST_CONFIG.timeout.navigation });
}

/** 提需求 → 等出卡。返回表单卡片 locator。 */
async function askForFormCard(page: Page, question: string) {
  await page.getByTestId('chat-input').fill(question);
  await page.getByTestId('send-button').click();
  const card = page.locator('[data-card-type="form"]').last();
  await expect(card).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
  await expect(card).toContainText(/外部对照/);
  return card;
}

/** 按卡片字段名填值：参与方 / 数据产品是下拉（目录非空时），分层键是文本框。 */
async function fillFormCard(
  page: Page,
  values: { trial: string; controls: string; strataKeys: string[] },
): Promise<void> {
  await page.selectOption('[name="trial"]', values.trial);
  if (await page.locator('[name="trialDataProduct"]').isVisible()) {
    await page.selectOption('[name="trialDataProduct"]', TEST_CONFIG.testData.trial.dataProductId);
  }
  await page.selectOption('[name="controls"]', values.controls);
  if (await page.locator('[name="controlsDataProduct"]').isVisible()) {
    await page.selectOption(
      '[name="controlsDataProduct"]',
      TEST_CONFIG.testData.controls.dataProductId,
    );
  }
  await page.fill('[name="strataKeys"]', values.strataKeys.join(', '));
  // 可选数值参数：卡片有才填
  for (const [name, value] of [
    ['caliperDays', TEST_CONFIG.testData.caliperDays],
    ['ratioK', TEST_CONFIG.testData.ratioK],
  ] as Array<[string, number]>) {
    const field = page.locator(`[name="${name}"]`);
    if (await field.isVisible()) await field.fill(String(value));
  }
}

test.describe('RWD 单臂药物注册完整流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    test.setTimeout(180_000);
    // 客户端异常与失败请求都打出来：避免"页面白了但没有原因"
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('CONSOLE_ERROR', message.text().slice(0, 300));
    });
    await stubControlPlane(page);
  });

  test('完整演示：从登录到任务提交', async ({ page }) => {
    // ============================================
    // 第一步：登录系统
    // ============================================
    await test.step('访问登录页面', async () => {
      await page.goto(`${TEST_CONFIG.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('#account').waitFor({ timeout: TEST_CONFIG.timeout.login });
      await page.screenshot({ path: 'test-results/01-login-page.png', fullPage: true });
    });

    await test.step('输入账号、密码与验证码', async () => {
      // 真实登录页是「账号 + 密码 + 图形验证码」三个字段（不是 email/password）
      await page.fill('#account', TEST_CONFIG.testUser.account);
      await page.fill('#password', TEST_CONFIG.testUser.password);
      await page.fill('#captcha', 'DEMO');
      await page.screenshot({ path: 'test-results/02-login-filled.png' });
    });

    await test.step('提交登录并进入控制台', async () => {
      await page.locator('button[type="submit"]').first().click();
      // 判据：控制台侧栏的「退出登录」出现（AuthGate 已通过 /auth/profile）
      await page.locator('button[title="退出登录"]').waitFor({ timeout: TEST_CONFIG.timeout.login });
      await page.screenshot({ path: 'test-results/03-dashboard.png', fullPage: true });
    });

    // ============================================
    // 第二步：进入 Chat Agent
    // ============================================
    await test.step('导航到 AI 助手页面', async () => {
      await page.goto(`${TEST_CONFIG.baseUrl}/space/chat`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chat-input')).toBeVisible({
        timeout: TEST_CONFIG.timeout.navigation,
      });
      await page.screenshot({ path: 'test-results/04-chat-page.png', fullPage: true });
    });

    // ============================================
    // 第三步：用自然语言提需求
    // ============================================
    await test.step('发送用户消息', async () => {
      await page.getByTestId('chat-input').fill('我想做一个单臂试验的外部对照分析，用于药物注册申请');
      await page.screenshot({ path: 'test-results/05-user-message-typed.png' });
      await page.getByTestId('send-button').click();
    });

    await test.step('等待 Agent 响应', async () => {
      await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({
        timeout: TEST_CONFIG.timeout.agentResponse,
      });
      await page.screenshot({ path: 'test-results/06-agent-response.png', fullPage: true });
    });

    // ============================================
    // 第四步：填写配置表单 Card
    // ============================================
    await test.step('等待配置表单出现', async () => {
      const card = page.locator('[data-card-type="form"]').last();
      await expect(card).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
      // 卡片标题由场景表生成：「单臂试验外部对照 · 参数配置」，断言到场景关键字即可
      await expect(card).toContainText(/外部对照/);
      await scrollIntoView(page, '[data-card-type="form"]');
      await page.screenshot({ path: 'test-results/07-form-card.png', fullPage: true });
    });

    await test.step('填写试验方信息', async () => {
      await page.selectOption('[name="trial"]', TEST_CONFIG.testData.trial.participantId);
      if (await page.locator('[name="trialDataProduct"]').isVisible()) {
        await page.selectOption(
          '[name="trialDataProduct"]',
          TEST_CONFIG.testData.trial.dataProductId,
        );
      }
      await page.screenshot({ path: 'test-results/08-trial-filled.png' });
    });

    await test.step('填写对照方信息', async () => {
      await page.selectOption('[name="controls"]', TEST_CONFIG.testData.controls.participantId);
      if (await page.locator('[name="controlsDataProduct"]').isVisible()) {
        await page.selectOption(
          '[name="controlsDataProduct"]',
          TEST_CONFIG.testData.controls.dataProductId,
        );
      }
      await page.screenshot({ path: 'test-results/09-controls-filled.png' });
    });

    await test.step('填写分层键与匹配参数', async () => {
      await page.fill('[name="strataKeys"]', TEST_CONFIG.testData.strataKeys.join(', '));
      for (const [name, value] of [
        ['caliperDays', TEST_CONFIG.testData.caliperDays],
        ['ratioK', TEST_CONFIG.testData.ratioK],
      ] as Array<[string, number]>) {
        const field = page.locator(`[name="${name}"]`);
        if (await field.isVisible()) await field.fill(String(value));
      }
      await page.screenshot({ path: 'test-results/10-strata-keys-filled.png' });
      await page.screenshot({ path: 'test-results/11-all-params-filled.png', fullPage: true });
    });

    // ============================================
    // 第五步：提交任务
    // ============================================
    let jobId: string | null = null;

    await test.step('点击提交按钮', async () => {
      await page.screenshot({ path: 'test-results/12-ready-to-submit.png' });
      await page.locator('[data-testid="submit-card"]').last().click();
    });

    await test.step('等待任务创建响应', async () => {
      // 状态卡一旦带上 data-job-id，就说明控制面桩已受理并回了作业号
      await expect(page.locator('[data-card-type="status"][data-job-id]').last()).toBeVisible({
        timeout: TEST_CONFIG.timeout.taskSubmit,
      });
      // 控制台是固定高度的内部滚动容器：不滚到结果卡，"fullPage" 也拍不到它。
      await scrollIntoView(page, '[data-card-type="status"][data-job-id]');
      await page.screenshot({ path: 'test-results/13-task-submitted.png', fullPage: true });
    });

    await test.step('提取任务 ID', async () => {
      const card = page.locator('[data-card-type="status"][data-job-id]').last();
      jobId = await card.getAttribute('data-job-id');
      await expect(card).toContainText(/任务已提交/);
      expect(jobId).toBeTruthy();
      console.log(`✅ 任务 ID: ${jobId}`);
    });

    // ============================================
    // 第六步：验证任务状态
    // ============================================
    await test.step('检查状态卡片', async () => {
      const statusCard = page.locator('[data-card-type="status"]').last();
      await scrollIntoView(page, '[data-card-type="status"]');
      await expect(statusCard).toHaveAttribute('data-tone', 'success');
      await page.screenshot({ path: 'test-results/14-task-status.png', fullPage: true });
    });

    await test.step('继续追问（会话上下文仍在）', async () => {
      // 相对计数：写死 "2" 会**因为恰好撞上中间态而通过**（提交回复刚到、追问回复还没到），
      // 这是本轮踩到的假绿——断言必须表达"又多了一条"，而不是某个瞬时数字。
      const before = await page.locator('[data-role="assistant"]').count();
      await page.getByTestId('chat-input').fill(`任务 ${jobId} 的状态是什么？`);
      await page.getByTestId('send-button').click();
      // 只断言"助手又回了一条"，不假装有查作业状态的工具（当前工具集里确实没有）
      await expect(page.locator('[data-role="assistant"]')).toHaveCount(before + 1, {
        timeout: TEST_CONFIG.timeout.agentResponse,
      });
      await page.screenshot({ path: 'test-results/15-task-status-query.png', fullPage: true });
    });

    // ============================================
    // 第七步：完成演示
    // ============================================
    await test.step('最终截图', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: 'test-results/16-final-complete.png', fullPage: true });
      // 会话在侧栏留下痕迹（会话列表来自 chat-agent 的真实持久化）
      await expect(page.getByTestId('session-rail')).toBeVisible();
    });

    expect(jobId).toBeTruthy();
    console.log(`\n🎉 RWD 单臂药物注册场景演示完成，任务 ID: ${jobId}`);
  });

  // ============================================
  // 额外用例：跨字段校验（试验方 = 对照方）必须被拦住
  // ============================================
  test('错误场景：试验方与对照方相同被拒', async ({ page }) => {
    await login(page);
    await openChat(page);
    const card = await askForFormCard(page, '我想做单臂试验的外部对照');

    // 故意把对照方选成与试验方相同
    await fillFormCard(page, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.trial.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await card.locator('[data-testid="submit-card"]').click();

    // 服务端跨字段校验拦截 → 错误卡 + 预填回卡（可以直接改一处再提交，不必从头描述）
    const errorCard = page.locator('[data-card-type="status"][data-tone="error"]').last();
    await expect(errorCard).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await expect(errorCard).toContainText(/不能是同一参与方/);
    // 预填回卡：值要真的带回来（这正是本轮修掉的那个缺陷）
    const retryCard = page.locator('[data-card-type="form"]').last();
    await expect(retryCard).toContainText(/修改后重新提交/);
    await expect(retryCard.locator('[name="trial"]')).toHaveValue('p-sponsor');
    await expect(retryCard.locator('[name="controls"]')).toHaveValue('p-sponsor');

    await scrollIntoView(page, '[data-card-type="status"][data-tone="error"]');
    await page.screenshot({ path: 'test-results/error-validation.png', fullPage: true });
  });
});
