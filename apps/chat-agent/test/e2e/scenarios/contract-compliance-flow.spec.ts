import { expect, test } from '@playwright/test';
import {
  TEST_CONFIG,
  ask,
  askForFormCard,
  fillFormCard,
  grantDataAccess,
  login,
  openChat,
  resetStub,
  startNewSession,
  stubAuditEntries,
  stubControlPlane,
} from '../support/chat-demo';

// 合规集成（ai-chat-agent-compliance-integration）的**浏览器级**流程。
//
// 验的是"AI 助手不再能绕过合约"在真实页面上成立：
//   无可用合约 → 提交被拦（给出原因）→ 出合约审批卡 → 用户点"同意并提交申请"
//   → 状态卡"申请已提交（待签发）" → **医院签发**（桩扮演，agent 侧没有这条路）
//   → 重新配置并提交 → 成功，且载荷带的是那份签发后的合约。
//
// 断言点刻意落在**数据属性**上（data-card-type / data-tone / data-job-id），不查文案：
// 文案会漂，契约不会。
test.describe('合规流程：无合约 → 申请 → 签发 → 提交', () => {
  test.beforeEach(async ({ page, request }) => {
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
    test.setTimeout(240_000);
    await stubControlPlane(page);
    // 每次从"完全没有可用合约"开始，并清掉上一轮留下的申请与审计
    await resetStub(request, 'missing');
  });

  // 桩是**进程级共享状态**（同一轮 e2e 里其他场景也要用它）。跑完必须还原成默认的
  // "已有可用合约"，否则后面的演示场景会莫名其妙地卡在合约闸上。
  test.afterEach(async ({ request }) => {
    await resetStub(request, 'usable');
  });

  test('无合约时提交被拦、经合约申请与签发后重新提交成功', async ({ page, request, browser }) => {
    await login(page, 'pharma');
    await openChat(page);

    await test.step('配置任务并提交 → 被合规闸拦下', async () => {
      const form = await askForFormCard(page, '我想做单臂试验的外部对照');
      await fillFormCard(form, {
        trial: TEST_CONFIG.testData.trial.participantId,
        controls: TEST_CONFIG.testData.controls.participantId,
        strataKeys: TEST_CONFIG.testData.strataKeys,
      });
      await form.getByTestId('submit-card').click();

      // 没有可用的合约：出现申请卡（内容由工具生成，不是模型编的）
      const approval = page.locator('[data-card-type="contract_approval"]').last();
      await expect(approval).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
      await expect(approval).toContainText('数据合约申请审批');
      await expect(approval).toContainText('由数据提供方签发');
      // 被拦下的原因要能看见（控制面的错误码照抄，不翻译成"失败了"）
      await expect(page.getByTestId('message-list')).toContainText('E_CONTRACT_MISSING');
      await page.screenshot({ path: 'test-results/compliance-01-blocked-approval-card.png', fullPage: true });
    });

    await test.step('点"同意并提交申请" → 合约申请已提交（待签发）', async () => {
      const approval = page.locator('[data-card-type="contract_approval"]').last();
      await approval.getByTestId('submit-card').click();

      const pending = page.locator('[data-card-type="status"]').last();
      await expect(pending).toHaveAttribute('data-tone', 'pending', {
        timeout: TEST_CONFIG.timeout.agentResponse,
      });
      await expect(pending).toContainText('合约申请已提交');
      await expect(pending).toContainText('ct-req-1');
      await page.screenshot({ path: 'test-results/compliance-02-pending-offered.png', fullPage: true });
    });

    await test.step('医院在自己的控制台里签发（真实界面路径）', async () => {
      // 另一个参与方、另一个浏览器会话：申请在药企侧发出，签发必须由医院侧的人做。
      // 桩只扮演**连接器**那一步（用本院私钥签 ContractAgree，D-MDOP-4），页面交互是真的。
      const hospital = await browser.newPage();
      hospital.on('pageerror', (error) => console.log('PAGEERROR(hospital)', error.message));
      await stubControlPlane(hospital, 'hospital');
      await login(hospital, 'hospital');
      await hospital.goto(`${TEST_CONFIG.baseUrl}/space/contracts`, {
        waitUntil: 'domcontentloaded',
      });

      // 列表里就是药企刚递的那一份（合约 id 不在列表展示，用方向与状态定位）
      await expect(hospital.getByText('p-sponsor → p-hosp-a')).toBeVisible({
        timeout: TEST_CONFIG.timeout.navigation,
      });
      await expect(hospital.getByText('待审批')).toBeVisible();
      // exact：页头还有「直接签发」（跳过申请走另一条路），这里要的是**行内**那一个
      const issue = hospital.getByRole('button', { name: '签发', exact: true });
      await expect(issue).toBeVisible();
      await issue.click();
      // 签发后状态翻到「已生效」，签发按钮消失（canApprove=false）
      await expect(hospital.getByText('已生效')).toBeVisible({
        timeout: TEST_CONFIG.timeout.agentResponse,
      });
      await expect(hospital.getByRole('button', { name: '签发', exact: true })).toHaveCount(0);
      await hospital.screenshot({ path: 'test-results/compliance-04-hospital-signed.png', fullPage: true });
      await hospital.close();
    });

    await test.step('回到药企侧继续配置并提交成功', async () => {
      await expect(page.locator('[data-role="assistant"]').last()).toBeVisible();

      // 换一个新会话再配置：用户拿到"签发后可继续"的提示后从干净界面开始，
      // 也让"这一次要填的卡"在界面上唯一（多轮后旧卡仍在，控件是 disabled 的）。
      await startNewSession(page);
      const form = await askForFormCard(page, '我想做单臂试验的外部对照');
      await fillFormCard(form, {
        trial: TEST_CONFIG.testData.trial.participantId,
        controls: TEST_CONFIG.testData.controls.participantId,
        strataKeys: TEST_CONFIG.testData.strataKeys,
      });
      await form.getByTestId('submit-card').click();

      const status = page.locator('[data-card-type="status"][data-tone="success"]').last();
      await expect(status).toBeVisible({ timeout: TEST_CONFIG.timeout.taskSubmit });
      await expect(status).toHaveAttribute('data-job-id', 'job-e2e-1');
      // 作业用的正是**签发后**那份合约（不是别的、也不是空的）
      await expect(status).toContainText('ct-req-1');
    });

    await test.step('合规动作在控制面留痕（审计链）', async () => {
      const entries = await stubAuditEntries(request);
      const resources = entries.map((entry) => `${entry.action}:${entry.resource}`);
      // 拦下的判定、真发出去的申请、真完成的作业，各留一条
      expect(resources).toContain('READ:compliance-gate');
      expect(resources).toContain('CREATE:contract');
      expect(resources).toContain('COMPUTE:rws-task');
      const submitted = entries.find((entry) => entry.action === 'COMPUTE');
      expect(submitted?.details).toMatchObject({
        source: 'ai-chat-agent',
        contractId: 'ct-req-1',
        jobId: 'job-e2e-1',
      });
      // 审计不记用户原话
      expect(JSON.stringify(entries)).not.toContain('我想做单臂试验的外部对照');
    });
  });

  test('已有可用合约时用户无感知：直接出配置卡并提交成功', async ({ page, request }) => {
    await resetStub(request, 'usable');
    await login(page, 'pharma');
    await openChat(page);

    const form = await askForFormCard(page, '我想做单臂试验的外部对照');
    // 有合约就不该拿合约问题打扰用户
    await expect(page.locator('[data-card-type="contract_approval"]')).toHaveCount(0);

    await fillFormCard(form, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await form.getByTestId('submit-card').click();

    const status = page.locator('[data-card-type="status"][data-tone="success"]').last();
    await expect(status).toBeVisible({ timeout: TEST_CONFIG.timeout.taskSubmit });
    await expect(status).toHaveAttribute('data-job-id', 'job-e2e-1');
    await expect(status).toContainText('ct-e2e-1');
  });

  test('合约未签发时如实说明"等签发"，不引导用户重复申请', async ({ page, request }) => {
    await resetStub(request, 'unsigned');
    await login(page, 'pharma');
    await openChat(page);

    const form = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(form, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await form.getByTestId('submit-card').click();

    const guide = page.locator('[data-card-type="contract_request"]').last();
    await expect(guide).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await expect(guide).toContainText('合约还没生效');
    await expect(guide).toContainText('等数据提供方签发');
    // 不该出现"再申请一份"的按钮
    await expect(guide.getByTestId('submit-card')).toHaveCount(0);
  });

  test('权限不足：不属于该空间的使用方被拦在权限上，且不误报成合约问题', async ({
    page,
    request,
  }) => {
    // 登录的是药企账号，但 `/auth/spaces` 说它不属于 sh-med —— 与 HTTP 级同样的拒绝路径
    await resetStub(request, 'usable');
    await stubControlPlane(page, 'pharma', {
      memberships: [{ spaceId: 'other-space', role: 'consumer' }],
      spaces: ['other-space'],
    });
    await login(page, 'pharma');
    await openChat(page);

    const form = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(form, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await form.getByTestId('submit-card').click();

    // 拦在权限上：错误可见，且**不出现**合约/授权类的"下一步"卡（别把用户引偏）
    await expect(page.getByTestId('message-list')).toContainText('不属于空间', {
      timeout: TEST_CONFIG.timeout.agentResponse,
    });
    await expect(page.locator('[data-card-type="contract_approval"]')).toHaveCount(0);
    await expect(page.locator('[data-card-type="contract_request"]')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/compliance-07-permission-denied.png', fullPage: true });
  });

  test('Phase 3 自动创建：预授权 + 院内自动签 → 用户确认后合约自动生效，直接提交成功', async ({
    page,
    request,
  }) => {
    // 无可用合约 + 已有 ACL 预授权 + 院内连接器策略=自动确认
    // （真实系统里这三件事分别由：合约状态、POST /data-access/grants、医院本地策略文件决定）
    await resetStub(request, 'missing', { connectorAutoSign: true });
    await login(page, 'pharma');
    await openChat(page);

    const form = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(form, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await form.getByTestId('submit-card').click();

    const approval = page.locator('[data-card-type="contract_approval"]').last();
    await expect(approval).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await approval.getByTestId('submit-card').click();

    // 关键断言：**没有医院那一步**，合约自己生效了
    const ready = page.locator('[data-card-type="status"][data-tone="success"]').last();
    await expect(ready).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await expect(ready).toContainText('合约已自动生效');
    await expect(ready).toContainText('ct-req-1');
    await page.screenshot({ path: 'test-results/compliance-05-auto-ready.png', fullPage: true });

    // 直接继续配置并提交（同一会话）
    await startNewSession(page);
    const retry = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(retry, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await retry.getByTestId('submit-card').click();

    const status = page.locator('[data-card-type="status"][data-tone="success"]').last();
    await expect(status).toBeVisible({ timeout: TEST_CONFIG.timeout.taskSubmit });
    await expect(status).toHaveAttribute('data-job-id', 'job-e2e-1');
  });

  test('产品级 ACL：没有访问授权时被拦，提供方授予后同一次提交通过', async ({ page, request }) => {
    // 合约有（usable），但访问授权被清空 → 验的是 ACL 这一层，不是合约那一层
    await resetStub(request, 'usable', { grants: [] });
    await login(page, 'pharma');
    await openChat(page);

    const form = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(form, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await form.getByTestId('submit-card').click();

    // 拦下来的卡是"访问授权"语义，不是"合约"语义（别把用户引偏）
    const guide = page.locator('[data-card-type="contract_request"]').last();
    await expect(guide).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await expect(guide).toContainText('访问授权');
    await expect(guide).toContainText('数据提供方');
    await expect(page.locator('[data-card-type="contract_approval"]')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/compliance-06-acl-denied.png', fullPage: true });

    // 提供方授予访问权（真实端点：POST /data-access/grants）
    await grantDataAccess(request, {
      dataProductId: TEST_CONFIG.testData.trial.dataProductId,
      granteeParticipantId: 'p-sponsor',
    });
    await grantDataAccess(request, {
      dataProductId: TEST_CONFIG.testData.controls.dataProductId,
      granteeParticipantId: 'p-sponsor',
    });

    // 换新会话再配置：与主链路同样的理由（多轮后旧卡仍在界面上，控件是 disabled 的）
    await startNewSession(page);
    const retry = await askForFormCard(page, '我想做单臂试验的外部对照');
    await fillFormCard(retry, {
      trial: TEST_CONFIG.testData.trial.participantId,
      controls: TEST_CONFIG.testData.controls.participantId,
      strataKeys: TEST_CONFIG.testData.strataKeys,
    });
    await retry.getByTestId('submit-card').click();

    const status = page.locator('[data-card-type="status"][data-tone="success"]').last();
    await expect(status).toBeVisible({ timeout: TEST_CONFIG.timeout.taskSubmit });
    await expect(status).toHaveAttribute('data-job-id', 'job-e2e-1');
  });

  test('问"有哪些场景"不会误触提交（只是查询，不该出合约卡）', async ({ page, request }) => {
    await resetStub(request, 'missing');
    await login(page, 'pharma');
    await openChat(page);

    await ask(page, '现在有哪些可用的计算场景？');
    const list = page.locator('[data-card-type="result"]').last();
    await expect(list).toBeVisible({ timeout: TEST_CONFIG.timeout.agentResponse });
    await expect(list).toContainText('单臂试验外部对照');
    await expect(page.locator('[data-card-type="contract_approval"]')).toHaveCount(0);
  });
});
