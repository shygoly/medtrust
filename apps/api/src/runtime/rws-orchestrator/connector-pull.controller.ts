import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConnectorTokenGuard } from '../../common/guards/connector-token.guard';
import { CatalogService } from '../catalog/catalog.service';
import { RwsOrchestratorService } from './rws-orchestrator.service';

/** Connector outbound pull API — no inbound port on hospital side. */
@ApiTags('connector-pull')
@Controller('connector')
@UseGuards(ConnectorTokenGuard)
export class ConnectorPullController {
  constructor(
    private readonly rws: RwsOrchestratorService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('rws/pending')
  @ApiOperation({ summary: '连接器出站拉取待执行 RWS 分派' })
  pullPending(@Req() req: { connectorParticipantId: string }) {
    return this.rws.pullPending(req.connectorParticipantId);
  }

  @Post('rws/assignments/:assignmentId/complete')
  @ApiOperation({ summary: '连接器回传本地聚合结果' })
  complete(
    @Param('assignmentId') assignmentId: string,
    @Req() req: { connectorParticipantId: string },
    @Body() body: { aggregate?: unknown; error?: string },
  ) {
    return this.rws.completeAssignment(assignmentId, req.connectorParticipantId, body as any);
  }

  @Post('rws/assignments/:assignmentId/progress')
  @ApiOperation({ summary: '连接器上报执行阶段进度' })
  progress(
    @Param('assignmentId') assignmentId: string,
    @Req() req: { connectorParticipantId: string },
    @Body() body: { stage: string; detail?: string },
  ) {
    return this.rws.reportProgress(
      assignmentId,
      req.connectorParticipantId,
      body.stage as any,
      body.detail,
    );
  }

  @Get('catalog/:id')
  @ApiOperation({ summary: '连接器拉取本机构数据产品元数据（含 localDataPath）' })
  async catalogProduct(
    @Param('id') id: string,
    @Req() req: { connectorParticipantId: string },
  ) {
    const product = await this.catalog.get(id);
    if (!product) throw new NotFoundException('数据产品不存在');
    if (product.providerId !== req.connectorParticipantId) {
      throw new ForbiddenException('仅可读取本机构数据产品元数据');
    }
    return product;
  }

  @Get('health')
  @ApiOperation({ summary: '连接器连通性探针' })
  health(@Query('participantId') participantId: string) {
    return { ok: true, participantId };
  }
}
