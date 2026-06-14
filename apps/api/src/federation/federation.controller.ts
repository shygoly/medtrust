import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FederationService } from './federation.service';

// 跨空间互联端点:发现远端可信空间的数据产品(只读元数据)。
@ApiTags('federation')
@ApiBearerAuth()
@Controller('federation')
@UseGuards(JwtAuthGuard)
export class FederationController {
  constructor(private readonly federation: FederationService) {}

  @Get('discover')
  discover() {
    return {
      trustedSpaces: this.federation.trustedSpaces(),
      remoteProducts: this.federation.discover(),
    };
  }
}
