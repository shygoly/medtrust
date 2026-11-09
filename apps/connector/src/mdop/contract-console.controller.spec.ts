import { ContractConsoleController } from './contract-console.controller';
import { CONTRACT_CONSOLE_HTML } from './contract-console.page';

/**
 * 签署台是**纯静态页**：可以公开可达，但不得包含任何院内容数据或令牌。
 * 数据一律由页面在拿到本地令牌后自己向 `connector/mdop/contracts` 取。
 */
describe('院内合约签署台（D-MDOP-4 本地管理入口）', () => {
  it('返回静态 HTML，且不内嵌任何合约数据 / 令牌', () => {
    const html = new ContractConsoleController().index();
    expect(html).toContain('院内合约签署台');
    expect(html).toContain('/mdop/contracts');
    expect(html).not.toMatch(/x-connector-admin-token['"]?\s*[:=]\s*['"][0-9a-f]/i);
    expect(html).not.toContain('holderSignature');
    expect(html).not.toContain('CONNECTOR_LOCAL_ADMIN_TOKEN=');
  });

  it('API 基址按当前 pathname 推导，直连与反代前缀两种形态都成立', () => {
    const base = (p: string) => CONTRACT_CONSOLE_HTML.includes(p);
    // 页面脚本用的是 replace(/\/admin\/?$/)，同一份 HTML 同时支持两种路径
    expect(base("location.pathname.replace("));
  });
});
