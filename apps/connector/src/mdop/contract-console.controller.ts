import { Controller, Get, Header } from '@nestjs/common';
import { CONTRACT_CONSOLE_HTML } from './contract-console.page';

/**
 * 院内合约签署台（浏览器形态的本地管理入口，D-MDOP-4 第 3 步）。
 *
 * 这个 GET 只回**静态 HTML**：不含任何合约数据、不读数据库、不碰私钥。
 * 真正的列表 / 签署 / 拒绝仍走 `connector/mdop/contracts`（`LocalAdminGuard` 校验本地令牌）。
 * 所以即使页面被反代到演示域名下，没有令牌也拿不到任何院内容数据。
 */
@Controller('connector')
export class ContractConsoleController {
  @Get(['admin', 'admin/'])
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex, nofollow')
  @Header('referrer-policy', 'no-referrer')
  index(): string {
    return CONTRACT_CONSOLE_HTML;
  }
}
