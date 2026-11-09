import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MdopContractStore } from './contract-store';
import { MdopNodeService } from './mdop-node.service';
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
  constructor(
    private readonly store: MdopContractStore,
    private readonly node: MdopNodeService,
  ) {}

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
    // 本地签名之后**立刻**把 ContractAgree 发回平台（`confirmOffer`），不再依赖人工转交：
    // 只签不发会让平台永远停在 offered（历史上就是 CLI 打印 agreement 给人抄）。
    //
    // 业务拒绝（要约不存在/过期/已拒绝）与平台回执失败都是**可解释的失败**：
    // 必须回 4xx + 原文，不能落到 Nest 的 500 "Internal server error"——
    // 签署台只能显示 message，500 会让医院无从判断是该刷新、重签还是找平台。
    try {
      return await this.node.confirmOffer(offerId, req.localAdminActor);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '签署失败',
      );
    }
  }

  @Post('pending/:offerId/reject')
  async reject(
    @Param('offerId') offerId: string,
    @Body('reason') reason: string,
    @Req() req: { localAdminActor: string },
  ) {
    try {
      await this.store.reject(offerId, req.localAdminActor, reason ?? '未说明');
      return { offerId, status: 'rejected' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '拒绝失败',
      );
    }
  }

  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: { localAdminActor: string },
  ) {
    // 本地撤销立即生效；返回的 notice 由调用方转交平台（平台是否收到不影响本地生效）。
    try {
      return await this.store.revoke(id, req.localAdminActor, reason ?? '院内撤销');
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '撤销失败',
      );
    }
  }
}
