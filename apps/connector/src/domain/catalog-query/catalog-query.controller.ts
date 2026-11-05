import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConnectorTokenGuard } from '../connector-token.guard';
import { CatalogQueryService } from './catalog-query.service';

/**
 * 连接器只读目录（NDI-TR-2025-05 §7.2）。
 *
 * 部署边界：仅在院内网络可达；`5022` MUST NOT 发布到院内网之外。
 * 鉴权：`X-Connector-Token`（ConnectorTokenGuard，未配置令牌即 401）。
 */
@Controller('connector/catalog')
@UseGuards(ConnectorTokenGuard)
export class CatalogQueryController {
  constructor(private readonly catalog: CatalogQueryService) {}

  @Get('products')
  list(
    @Req() req: { connectorParticipantId?: string },
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.catalog.assertEnabled();
    this.catalog.assertPeerAllowed(String(req.connectorParticipantId ?? ''));
    return this.catalog.list({
      q,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }

  @Get('products/:id')
  get(@Req() req: { connectorParticipantId?: string }, @Param('id') id: string) {
    this.catalog.assertEnabled();
    this.catalog.assertPeerAllowed(String(req.connectorParticipantId ?? ''));
    return this.catalog.get(id);
  }
}
