import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 守护：浏览器 E2E 拉起的 chat-agent **必须**显式钉死确定性模式与桩上游。
 *
 * 为什么需要这条：本仓的 `apps/chat-agent/.env` 里配了 `LLM_PROVIDER=deepseek`（真实使用），
 * 而 dotenv 不覆盖已有的 `process.env`，于是 webServer 命令里的变量会生效、.env 只补空缺——
 * 但**如果没有在命令里写** `LLM_PROVIDER=rule-based`，测试就会继承 .env 去调真模型：
 * 既失去确定性（断言随机失败、跑 13 分钟）、又烧真 key 的 token、还把用户文本发给外部供应商。
 * 这条实际发生过，所以用测试钉住。
 */
describe('playwright.config 的 E2E 服务定义（防"测试调真模型"回归）', () => {
  const config = readFileSync(join(__dirname, '../../playwright.config.ts'), 'utf8');

  it('chat-agent 的 webServer 命令钉死了 LLM_PROVIDER=rule-based 与桩地址', () => {
    expect(config).toContain('LLM_PROVIDER=rule-based');
    expect(config).toContain('MEDTRUST_API_URL=http://localhost:5099');
  });

  it('控制面桩服务在 webServer 列表里（提交路径不依赖真控制面）', () => {
    expect(config).toContain('stub-control-plane.mjs');
  });
});
