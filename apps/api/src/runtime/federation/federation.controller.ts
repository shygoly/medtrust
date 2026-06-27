import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { FederationService } from './federation.service';

// 跨空间互联端点:发现远端可信空间的数据产品(只读元数据)。
@ApiTags('federation')
@ApiBearerAuth()
@Controller('federation')
@UseGuards(JwtAuthGuard)
export class FederationController {
  constructor(private readonly federation: FederationService) {}

  @Get('discover')
  async discover() {
    const [trustedSpaces, remoteProducts] = await Promise.all([
      this.federation.trustedSpaces(),
      this.federation.discover(),
    ]);
    return { trustedSpaces, remoteProducts };
  }

  // 互通网关:对一个远端数据产品 URN 给出跨空间下发决策(握手/路由)。
  @Get('relay-plan')
  relayPlan(@Query('urn') urn: string) {
    return this.federation.relayPlan(urn || '');
  }
}
