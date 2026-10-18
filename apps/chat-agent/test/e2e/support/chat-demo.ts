import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 浏览器级演示的公共装置（两个场景共用）。
 *
 * 三条链路里两段是真的：
 *   浏览器 ──真──▶ apps/web（:5020，生产构建 next start）
 *   浏览器 ──真──▶ apps/chat-agent（:5032，rule-based 模式，无需 LLM key）
 *   chat-agent ──桩──▶ 控制面 API（:5099，见 test/stub-control-plane.mjs）
 * 登录用的控制面（:5021）也在**浏览器侧打桩**：演示要验的是
 * 「浏览器 → web → chat-agent → 控制面桩」这条业务链，而不是认证后端。
 */
export const TEST_CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:5020',
  stubControlPlaneUrl: process.env.STUB_URL || 'http://localhost:5099',
  testUser: {
    // 与 apps/web/src/app/login/page.tsx 的 DEMO_ACCOUNTS 同源
    account: process.env.TEST_USER_ACCOUNT || 'admin@demohospa-hospital.com',
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

/**
 * 演示用的两个身份（与 apps/web 登录页的 DEMO_ACCOUNTS 同源）。
 *
 * 为什么要两个：合规流程里"申请"和"签发"本来就是**两个参与方**的动作——
 * 药企（使用方）发起申请，医院（提供方）在合约页签发。只有一个账号的话，
 * 只能用测试后门假装签发过，验不到"人在界面上点签发"这条真实路径。
 * `participantId` 必须与控制面 fixture 对齐（把 p-sponsor↔p-hosp-a 那份合约对上）。
 */
export const DEMO_ACCOUNTS = {
  hospital: {
    account: 'admin@demohospa-hospital.com',
    user: {
      id: 42,
      email: 'admin@demohospa-hospital.com',
      name: '示范甲医院 · 提供方',
      role: 'provider' as const,
      participantId: 'p-hosp-a',
    },
  },
  pharma: {
    account: 'pv@demo-pharma.example',
    user: {
      id: 43,
      email: 'pv@demo-pharma.example',
      name: '创新药企 · 使用方',
      role: 'consumer' as const,
      participantId: 'p-sponsor',
    },
  },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

/** 兼容旧引用（既有演示脚本按 demo 账号登录，语义等同医院/提供方）。 */
export const DEMO_USER = DEMO_ACCOUNTS.hospital.user;

/**
 * 登录 + 控制面都在浏览器侧预置。
 *
 * 为什么能这么干：`useAuth()` 读的是 localStorage（token + user），AuthGate 再拿 token
 * 调 `/auth/profile`。所以只要把这几个端点挡在浏览器侧，登录页面走的仍是**真实**流程
 * （填表 → 校验 → saveSession → router.push），无需拉起 apps/api 与本机数据库。
 */
export async function stubControlPlane(
  page: Page,
  who: DemoRole = 'hospital',
  /**
   * 覆盖 `/auth/spaces` 的成员关系：默认"属于 sh-med"。
   * 传别的空间即可造"不属于该空间"的权限场景（Phase 6.2 的拒绝流程）。
   */
  options: { memberships?: Array<{ spaceId: string; role: string }>; spaces?: string[] } = {},
): Promise<void> {
  const session = DEMO_ACCOUNTS[who];
  await page.route('http://localhost:5021/**', async (route) => {
    const url = route.request().url();
    // 合约/预审端点**转发到控制面桩进程**（:5099）：chat-agent 读的是它，
    // Web 控制台读的是 :5021；不共用同一份状态的话，"医院签发完 chat 却还看不到"
    // 或者"两边合约不一样"，用例就在验一个不存在的世界。
    if (/\/api\/v1\/(contracts|compositions)/.test(url)) {
      const response = await route.fetch({ url: url.replace(/^http:\/\/localhost:5021/, TEST_CONFIG.stubControlPlaneUrl) });
      await route.fulfill({ response });
      return;
    }
    if (url.includes('/auth/spaces')) {
      const memberships = options.memberships ?? [{ spaceId: 'sh-med', role: session.user.role }];
      await route.fulfill({
        json: {
          spaces: options.spaces ?? memberships.map((m) => m.spaceId),
          spaceId: (options.spaces ?? memberships.map((m) => m.spaceId))[0] ?? null,
          memberships,
        },
      });
      return;
    }
    if (url.includes('/auth/captcha')) {
      await route.fulfill({
        json: { captchaId: 'demo-captcha', image: TINY_PNG, expiresInSeconds: 300 },
      });
      return;
    }
    if (url.includes('/auth/login')) {
      await route.fulfill({
        json: {
          user: session.user,
          access_token: 'demo-access-token',
          refresh_token: 'demo-refresh-token',
        },
      });
      return;
    }
    if (url.includes('/auth/profile') || url.includes('/auth/me')) {
      await route.fulfill({
        json: {
          userId: session.user.id,
          email: session.user.email,
          participantId: session.user.participantId,
          role: session.user.role,
          spaces: options.spaces ?? ['sh-med'],
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

/** 登录并断言真的进了控制台（判据是侧栏的「退出登录」按钮，不是文案）。 */
export async function login(page: Page, who: DemoRole = 'hospital'): Promise<void> {
  await page.goto(`${TEST_CONFIG.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#account').waitFor({ timeout: TEST_CONFIG.timeout.login });
  await page.fill('#account', DEMO_ACCOUNTS[who].account);
  await page.fill('#password', TEST_CONFIG.testUser.password);
  await page.fill('#captcha', 'DEMO');
  await page.locator('button[type="submit"]').first().click();
  await page.locator('button[title="退出登录"]').waitFor({ timeout: TEST_CONFIG.timeout.login });
}

/** 进入 AI 助手页（真实路由是 /space/chat）。 */
export async function openChat(page: Page): Promise<void> {
  await page.goto(`${TEST_CONFIG.baseUrl}/space/chat`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: TEST_CONFIG.timeout.navigation });
}

export async function ask(page: Page, question: string): Promise<void> {
  // `fill` 会等到输入框可用：上一轮还在跑时面板整体 disabled，这时点发送会被
  // `send()` 直接 return（"发了但没反应"）。顺序必须是**先填再等按钮可用**——
  // 按钮在输入为空时本就是 disabled 的，先等按钮可用会永远等不到。
  await page.getByTestId('chat-input').fill(question);
  await expect(page.getByTestId('send-button')).toBeEnabled({ timeout: TEST_CONFIG.timeout.agentResponse });
  await page.getByTestId('send-button').click();
}

/**
 * 提需求 → 等出卡。返回**新出现的那张**表单卡片的 locator。
 *
 * 关键：要等"卡片数 +1"，不能只等"最后一张可见"。多轮对话里上一轮的表单卡还在页面上
 * （已被提交、控件 disabled），只等可见会拿到那张旧卡，然后在"填不进去"上超时——
 * 这个坑在本 change 的浏览器级用例里踩过。
 */
export async function askForFormCard(page: Page, question: string) {
  const forms = page.locator('[data-card-type="form"]');
  const before = await forms.count();
  await ask(page, question);
  await expect(forms).toHaveCount(before + 1, { timeout: TEST_CONFIG.timeout.agentResponse });
  const card = forms.last();
  await expect(card).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
  await expect(card).toContainText(/外部对照/);
  return card;
}

/** 开一个新会话（多轮之后界面上的卡会堆叠，换会话可让"这次要填的卡"唯一）。 */
export async function startNewSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新会话' }).click();
  await expect(page.locator('[data-card-type]')).toHaveCount(0, {
    timeout: TEST_CONFIG.timeout.navigation,
  });
}

/**
 * 按卡片字段名填值：参与方 / 数据产品是下拉（目录非空时），分层键是文本框。
 *
 * 参数是**卡片 locator**而不是 page：多轮对话里同一份表单会出现多张
 * （改一次再提交、被拦后重来），页面级选择器会命中上一张（已提交 → disabled），
 * 于是"填不进去"而不是"填错了"——这个坑在浏览器级用例里踩过一次。
 */
export async function fillFormCard(
  card: Locator,
  values: { trial: string; controls: string; strataKeys: string[] },
): Promise<void> {
  // 先确认这张卡的控件**可编辑**：已提交的旧卡控件是 disabled 的，若拿错卡，
  // 这里 15 秒就报出来（而不是在 selectOption 上等满整个用例超时）。
  const trial = card.locator('[name="trial"]');
  await expect(trial).toBeEnabled({ timeout: 15_000 });
  await trial.selectOption(values.trial);
  const trialProduct = card.locator('[name="trialDataProduct"]');
  if (await trialProduct.isVisible()) {
    await trialProduct.selectOption(TEST_CONFIG.testData.trial.dataProductId);
  }
  await card.locator('[name="controls"]').selectOption(values.controls);
  const controlsProduct = card.locator('[name="controlsDataProduct"]');
  if (await controlsProduct.isVisible()) {
    await controlsProduct.selectOption(TEST_CONFIG.testData.controls.dataProductId);
  }
  await card.locator('[name="strataKeys"]').fill(values.strataKeys.join(', '));
  // 可选数值参数：卡片有才填
  for (const [name, value] of [
    ['caliperDays', TEST_CONFIG.testData.caliperDays],
    ['ratioK', TEST_CONFIG.testData.ratioK],
  ] as Array<[string, number]>) {
    const field = card.locator(`[name="${name}"]`);
    if (await field.isVisible()) await field.fill(String(value));
  }
}

/** 桩的控制端点：重置状态 / 扮演医院签发（真实系统里由连接器做，agent 侧没有这条路）。 */
export async function resetStub(
  request: { post: (url: string, opts: { data: unknown }) => Promise<unknown> },
  contractMode: 'usable' | 'missing' | 'unsigned' | 'expired',
  options: { grants?: unknown[]; connectorAutoSign?: boolean } = {},
): Promise<void> {
  await request.post(`${TEST_CONFIG.stubControlPlaneUrl}/api/v1/__test__/state`, {
    data: { contractMode, ...options },
  });
}

/**
 * 通过**真实端点**授予数据产品访问权（`POST /data-access/grants`，D-ACL-1）。
 *
 * 这里不是测试后门：走的是控制面契约（只是由桩实现）。之所以不点界面，是因为产品级 ACL
 * 的控制台页还没做——授予目前只有 API，界面是后续工作。
 */
export async function grantDataAccess(
  request: { post: (url: string, opts: { data: unknown }) => Promise<unknown> },
  input: { dataProductId: string; granteeParticipantId: string; permissions?: string[] },
): Promise<void> {
  await request.post(`${TEST_CONFIG.stubControlPlaneUrl}/api/v1/data-access/grants`, {
    data: { permissions: ['compute'], ...input },
  });
}

export async function revokeDataAccess(
  request: { post: (url: string, opts: { data: unknown }) => Promise<unknown> },
  grantId: string,
  reason: string,
): Promise<void> {
  await request.post(
    `${TEST_CONFIG.stubControlPlaneUrl}/api/v1/data-access/grants/${grantId}/revoke`,
    { data: { reason } },
  );
}

export async function stubAuditEntries(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}): Promise<Array<{ action: string; resource: string; details?: Record<string, unknown> }>> {
  const response = await request.get(`${TEST_CONFIG.stubControlPlaneUrl}/api/v1/__test__/state`);
  const state = (await response.json()) as {
    auditEntries: Array<{ action: string; resource: string; details?: Record<string, unknown> }>;
  };
  return state.auditEntries;
}
