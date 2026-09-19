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
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { ConnectorTokenGuard } from "../../common/guards/connector-token.guard";
import { CatalogService } from "../catalog/catalog.service";
import { RwsOrchestratorService } from "./rws-orchestrator.service";
import { FlOrchestratorService } from "../fl-orchestrator/fl-orchestrator.service";
import { ConnectorAuditService } from "../connector-audit/connector-audit.service";
import { ConnectorAdminService } from "../participant-identity/connector-admin.service";
import { AlgorithmModuleRegistry } from "../connector-modules/algorithm-module.registry";

/** Connector outbound pull API — no inbound port on hospital side. */
@ApiTags("connector-pull")
@Controller("connector")
// Machine-to-machine connector/worker loop (token-authed). Workers poll pending
// + post progress/complete every few seconds; behind the Fly proxy this shares
// one throttle bucket and trips 429 during concurrent multi-site compute
// (report v4 L2 华山). Human rate limits don't apply to trusted M2M endpoints.
@SkipThrottle()
@UseGuards(ConnectorTokenGuard)
export class ConnectorPullController {
  constructor(
    private readonly rws: RwsOrchestratorService,
    private readonly fl: FlOrchestratorService,
    private readonly catalog: CatalogService,
    private readonly connectorAudit: ConnectorAuditService,
    private readonly connectorAdmin: ConnectorAdminService,
    private readonly algorithmModules: AlgorithmModuleRegistry,
  ) {}

  @Post("heartbeat")
  @ApiOperation({ summary: "连接器周期心跳上报(版本/任务状态/资源水位)" })
  heartbeat(
    @Req() req: { connectorParticipantId: string },
    @Body()
    body: {
      connectorId?: string;
      version?: string;
      taskStatus?: Record<string, unknown>;
      resources?: Record<string, unknown>;
    },
  ) {
    return this.connectorAdmin.heartbeat(req.connectorParticipantId, body);
  }

  @Get("rws/pending")
  @ApiOperation({
    summary: "连接器出站拉取待执行 RWS 分派（已废弃，迁移期保留）",
    deprecated: true,
    description:
      "请改用 GET /connector/tasks/pending（统一长轮询，含 RWS/FL 预测/训练轮次，且带平台签名）。",
  })
  pullPending(@Req() req: { connectorParticipantId: string }) {
    return this.rws.pullPending(req.connectorParticipantId);
  }

  @Post("rws/assignments/:assignmentId/complete")
  @ApiOperation({ summary: "连接器回传本地聚合结果" })
  complete(
    @Param("assignmentId") assignmentId: string,
    @Req() req: { connectorParticipantId: string },
    @Body() body: { aggregate?: unknown; error?: string },
  ) {
    return this.rws.completeAssignment(
      assignmentId,
      req.connectorParticipantId,
      body as any,
    );
  }

  @Post("rws/assignments/:assignmentId/progress")
  @ApiOperation({ summary: "连接器上报执行阶段进度" })
  progress(
    @Param("assignmentId") assignmentId: string,
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

  @Get("fl-prediction/pending")
  @ApiOperation({
    summary: "连接器出站拉取待执行 FL 预测分派（已废弃，迁移期保留）",
    deprecated: true,
    description: "请改用 GET /connector/tasks/pending（统一长轮询）。",
  })
  pullPendingFl(@Req() req: { connectorParticipantId: string }) {
    return this.fl.pullPending(req.connectorParticipantId);
  }

  @Post("fl-prediction/assignments/:assignmentId/complete")
  @ApiOperation({ summary: "连接器回传本地 FL party 训练结果" })
  completeFl(
    @Param("assignmentId") assignmentId: string,
    @Req() req: { connectorParticipantId: string },
    @Body() body: { partyResult?: unknown; error?: string },
  ) {
    return this.fl.completeAssignment(
      assignmentId,
      req.connectorParticipantId,
      body,
    );
  }

  @Post("fl-prediction/assignments/:assignmentId/progress")
  @ApiOperation({ summary: "连接器上报 FL 执行阶段进度" })
  progressFl(
    @Param("assignmentId") assignmentId: string,
    @Req() req: { connectorParticipantId: string },
    @Body() body: { stage: string; detail?: string },
  ) {
    return this.fl.reportProgress(
      assignmentId,
      req.connectorParticipantId,
      body.stage as any,
      body.detail,
    );
  }

  @Get("catalog/:id")
  @ApiOperation({
    summary: "连接器拉取本机构数据产品元数据（含 localDataPath）",
  })
  async catalogProduct(
    @Param("id") id: string,
    @Req() req: { connectorParticipantId: string },
  ) {
    const product = await this.catalog.get(id);
    if (!product) throw new NotFoundException("数据产品不存在");
    if (product.providerId !== req.connectorParticipantId) {
      throw new ForbiddenException("仅可读取本机构数据产品元数据");
    }
    return product;
  }

  @Post("audit/digest")
  @ApiOperation({ summary: "连接器上报本地审计链摘要（含链式 prevHash）" })
  auditDigest(
    @Req() req: { connectorParticipantId: string },
    @Body()
    body: {
      count: number;
      firstPrevHash: string;
      lastEntryHash: string | null;
      blocked?: Array<{
        action: string;
        actor: string;
        detail?: string;
        entryHash: string;
        prevHash: string;
        at: string;
      }>;
    },
  ) {
    return this.connectorAudit.record(req.connectorParticipantId, body);
  }

  @Get("health")
  @ApiOperation({ summary: "连接器连通性探针" })
  health(@Query("participantId") participantId: string) {
    return { ok: true, participantId };
  }

  @Get("modules/:sm3")
  @ApiOperation({
    summary: "按 SM3 拉取签名算法模块(algorithm-sandbox D6)",
  })
  algorithmModule(@Param("sm3") sm3: string) {
    const mod = this.algorithmModules.get(sm3);
    if (!mod) throw new NotFoundException("算法模块不存在或未通过清单校验");
    return {
      analysisType: mod.analysisType,
      sm3: mod.sm3,
      abiVersion: mod.abiVersion,
      signature: mod.signature,
      bytes: mod.bytesBase64,
    };
  }
}
