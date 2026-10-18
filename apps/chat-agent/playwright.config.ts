import { defineConfig, devices } from '@playwright/test';

/**
 * 对话式任务配置的浏览器级 E2E（tasks 2.3）。
 *
 * 三条链路里两条是真的：
 *   浏览器 ──真──▶ apps/web (/space/chat)
 *   浏览器 ──真──▶ apps/chat-agent (:5032，rule-based 模式，无需 LLM key)
 *   chat-agent ──桩──▶ 控制面 (:5099)
 * 及一条 stub：控制面 API（真控制面要 DB/种子/合约，不适合进浏览器 E2E）。
 * 控制面之外的 5021（会话/空间）也在浏览器侧被 route 挡掉，见 spec 的 beforeEach。
 */
const WEB = 'http://localhost:5020';
const CHAT_AGENT = 'http://localhost:5032/api/v1/health';
const STUB = 'http://localhost:5099/api/v1/public/catalog?spaceId=sh-med';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // next dev 首次编译新路由时偶发客户端异常（chunk 竞态）；生产构建没有这个窗口。
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    trace: 'on-first-retry',
    // Phase 6.4 演示视频：RECORD_VIDEO=1 时录制（默认关，避免每次跑都产大文件）。
    // 产物在 test-results/<case>/video.webm —— 演示脚本用 SLOWMO=400 一并打开更好看。
    ...(process.env.RECORD_VIDEO === '1' ? { video: 'on' as const } : {}),
    viewport: { width: 1440, height: 900 },
    // 慢动作只能从配置给：`playwright test` 没有 `--slowmo` 这个参数
    // （那是 codegen/open 的选项）。演示脚本用 SLOWMO=400 打开，CI 默认 0。
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
    // 在你**自己的浏览器窗口**里演示：给一个 CDP 端点即可（见 scripts/demo-in-my-chrome.sh）。
    // 注意 connectOptions 走的是 Playwright 协议 —— 值必须是 ws:// 端点，不是 http://。
    ...(process.env.CDP_ENDPOINT
      ? { connectOptions: { wsEndpoint: process.env.CDP_ENDPOINT } }
      : {}),
    // 用本机安装的 Chrome（而不是 Playwright 自带 Chromium）跑：CHANNEL=chrome
    ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node test/stub-control-plane.mjs',
      url: STUB,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // 显式钉死确定性模式与桩上游：
      // - LLM_PROVIDER=rule-based：**测试绝不调真模型**（否则既失去确定性，又烧真 key 的 token，
      //   还会把用户文本发给外部供应商）。本仓 .env 里配了 deepseek，必须在这里覆盖掉。
      // - MEDTRUST_API_URL 指向控制面桩（真控制面要 DB/种子/已签合约，不适合浏览器 E2E）。
      // - RATE_LIMIT_PER_USER_PER_MIN=0：**关掉按用户限流**。浏览器级用例全部共用同一个
      //   演示账号（x-user-id 来自登录用户），合规集成把每轮的对话次数抬上去之后，
      //   后跑的用例会被自己的限流挡掉（现象是"助手没出卡"，根因却是 429）。
      //   限流本身有专门用例（src/common/rate-limit.guard.spec.ts + chat.e2e.spec.ts 的限流 describe）。
      command:
        'pnpm build && LLM_PROVIDER=rule-based MEDTRUST_API_URL=http://localhost:5099 RATE_LIMIT_PER_USER_PER_MIN=0 node dist/main.js',
      url: CHAT_AGENT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // 生产构建 + next start：没有 dev 的按需编译竞态，测的就是待发布形态。
      // （next 会提示 output:standalone 下应该用 server.js；实测 next start 能正常服务，
      //   这里保留标准启动方式，避免依赖 standalone 目录布局。）
      command: 'pnpm --filter web build && pnpm --filter web start',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
