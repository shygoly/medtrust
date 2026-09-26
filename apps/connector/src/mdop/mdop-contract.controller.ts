import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MdopContractStore } from './contract-store';
import { LocalAdminGuard } from './local-admin.guard';

/**
 * 合约本地确认入口（仅院内访问，D-MDOP-4）。
 *
 * 列出待确认要约 / 确认 / 拒绝 / 撤销。缺省人工确认；自动确认只由本地策略文件点名，
 * 与这些端点无关（策略命中时会自动走同一段 `confirm`，并标注 `auto(policy)`）。
 */
@Controller('connector/mdop/contracts')
@UseGuards(LocalAdminGuard)
export class MdopContractController {
  constructor(private readonly store: MdopContractStore) {}

  @Get()
  async list() {
    return {
      contracts: await this.store.list(),
      pending: await this.store.listPending(),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return {
      contract: await this.store.get(id),
      usable: await this.store.usableContract(id),
    };
  }

  @Post('pending/:offerId/confirm')
  async confirm(@Param('offerId') offerId: string, @Req() req: { localAdminActor: string }) {
    // 返回的 agreement 由调用方（CLI/院内端）回传平台，平台副署后本地副本才生效。
    return this.store.confirm(offerId, req.localAdminActor);
  }

  @Post('pending/:offerId/reject')
  async reject(
    @Param('offerId') offerId: string,
    @Body('reason') reason: string,
    @Req() req: { localAdminActor: string },
  ) {
    await this.store.reject(offerId, req.localAdminActor, reason ?? '未说明');
    return { offerId, status: 'rejected' };
  }

  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: { localAdminActor: string },
  ) {
    // 本地撤销立即生效；返回的 notice 由调用方转交平台（平台是否收到不影响本地生效）。
    return this.store.revoke(id, req.localAdminActor, reason ?? '院内撤销');
  }
}
