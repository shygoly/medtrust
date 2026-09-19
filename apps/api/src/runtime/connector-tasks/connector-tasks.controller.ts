import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { ConnectorTokenGuard } from "../../common/guards/connector-token.guard";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { stableStringify } from "../../common/canonical-json";
import { ConnectorAdminService } from "../participant-identity/connector-admin.service";
import { ConnectorAuthService } from "../participant-identity/connector-auth.service";
import { RwsOrchestratorService } from "../rws-orchestrator/rws-orchestrator.service";
import { FlOrchestratorService } from "../fl-orchestrator/fl-orchestrator.service";
import { FlRoundQueueService } from "../secretflow-orchestrator/fl-round-queue.service";
import { ConnectorTaskNotifier } from "./connector-task-notifier.service";
import { ConnectorTaskSigner } from "./connector-task-signer.service";
import { ConnectorTaskBatch, SignedConnectorTask } from "./types";

export const CONNECTOR_LONG_POLL_MAX_WAIT_MS = 25_000;

/** 服务端长轮询等待上限：默认取 CONNECTOR_LONG_POLL_WAIT_MS，硬上限 25 秒。 */
export function resolveLongPollWaitMs(raw?: string | number): number {
  const fallback = Number(
    process.env.CONNECTOR_LONG_POLL_WAIT_MS ?? CONNECTOR_LONG_POLL_MAX_WAIT_MS,
  );
  const requested = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(requested) || requested < 0) return 0;
  return Math.min(Math.floor(requested), CONNECTOR_LONG_POLL_MAX_WAIT_MS);
}

/**
 * 统一任务下发（outbound-longpoll-agent-auth D2）。
 *
 * 一次长轮询返回该院的 RWS、FL 预测、联邦训练轮次三类待办，每项都带平台 SM2 签名；
 * 没有待办时挂起请求，直到有新任务唤醒或超时（≤25s）。每次请求顺带刷新在线状态。
 *
 * 旧的 `connector/rws/pending`、`connector/fl-prediction/pending` 在迁移期保留（已废弃）。
 */
@ApiTags("connector-pull")
@Controller("connector")
@SkipThrottle()
@UseGuards(ConnectorTokenGuard)
export class ConnectorTasksController {
  private readonly logger = new Logger(ConnectorTasksController.name);

  constructor(
    private readonly rws: RwsOrchestratorService,
    private readonly fl: FlOrchestratorService,
    private readonly rounds: FlRoundQueueService,
    private readonly notifier: ConnectorTaskNotifier,
    private readonly signer: ConnectorTaskSigner,
    private readonly connectorAdmin: ConnectorAdminService,
    private readonly connectorAuth: ConnectorAuthService,
    private readonly gm: GMCryptoService,
  ) {}

  @Get("tasks/pending")
  @ApiOperation({
    summary:
      "连接器长轮询领取待办（RWS / FL 预测 / 联邦训练轮次，均带平台签名）",
  })
  async pending(
    @Req() req: { connectorParticipantId: string },
    @Query("waitMs") waitMsRaw?: string,
  ): Promise<ConnectorTaskBatch> {
    const participantId = req.connectorParticipantId;
    const waitMs = resolveLongPollWaitMs(waitMsRaw);

    // 每次长轮询都刷新在线状态（显式心跳另走 /connector/heartbeat，60s 一次）。
    await this.touch(participantId);

    // 1) 先登记等待者，再查待办：避免"查完没有、正要登记时恰好来了任务"漏唤醒。
    const waiter = this.notifier.begin(participantId);
    try {
      let batch = await this.collect(participantId);
      if (!hasAnyTask(batch) && waitMs > 0) {
        const reason = await waiter.wait(waitMs);
        this.logger.debug(
          `长轮询唤醒 participant=${participantId} reason=${reason}`,
        );
        batch = await this.collect(participantId);
      }
      return this.toSignedBatch(participantId, batch, waitMs);
    } finally {
      waiter.dispose();
    }
  }

  @Post("fl-rounds/:roundTaskId/complete")
  @ApiOperation({
    summary: "连接器回传本院联邦训练轮次结果（含 SM3 与连接器签名）",
  })
  async completeRound(
    @Param("roundTaskId") roundTaskId: string,
    @Req()
    req: { connectorParticipantId: string; connectorCertFingerprint?: string },
    @Body()
    body: {
      adapterDeltaJson?: string;
      sampleCount?: number;
      localLoss?: number;
      message?: string;
      resultSm3?: string;
      signature?: string;
      error?: string;
      contractId?: string;
    },
  ) {
    const participantId = req.connectorParticipantId;

    if (body.error) {
      this.rounds.fail(roundTaskId, participantId, body.error);
      return { accepted: true, failed: true };
    }
    if (typeof body.adapterDeltaJson !== "string") {
      throw new ForbiddenException("缺少 adapterDeltaJson");
    }

    // 结果摘要：对规范化结果算 SM3，并校验连接器对该摘要的 SM2 签名。
    const resultSm3 = this.gm.sm3Hash(
      stableStringify({
        adapterDeltaJson: body.adapterDeltaJson,
        sampleCount: body.sampleCount ?? 0,
        localLoss: body.localLoss ?? 0,
        message: body.message ?? "",
      }),
    );
    if (!body.resultSm3 || body.resultSm3.toLowerCase() !== resultSm3) {
      throw new ForbiddenException("训练结果 SM3 校验失败");
    }
    const fingerprint = req.connectorCertFingerprint ?? "";
    const verified =
      !!body.signature &&
      (await this.connectorAuth.verifyPayloadSignature(
        fingerprint,
        resultSm3,
        body.signature,
        participantId,
      ));
    if (!verified) {
      throw new UnauthorizedException("训练结果签名验证失败");
    }

    this.rounds.complete(roundTaskId, participantId, {
      adapterDeltaJson: body.adapterDeltaJson,
      sampleCount: Number(body.sampleCount ?? 0),
      localLoss: Number(body.localLoss ?? 0),
      message: body.message,
    });
    return { accepted: true };
  }

  /** 顺带刷新连接器在线状态（失败不影响拉任务）。 */
  private async touch(participantId: string): Promise<void> {
    try {
      await this.connectorAdmin.touch(participantId);
    } catch (err) {
      this.logger.debug(
        `刷新在线状态失败 participant=${participantId}: ${(err as Error).message}`,
      );
    }
  }

  private async collect(participantId: string): Promise<{
    rws: Awaited<ReturnType<RwsOrchestratorService["pullPending"]>>;
    flPrediction: Awaited<ReturnType<FlOrchestratorService["pullPending"]>>;
    flRounds: ReturnType<FlRoundQueueService["pullPendingRounds"]>;
  }> {
    const [rws, flPrediction, flRounds] = await Promise.all([
      this.rws
        .pullPending(participantId)
        .catch((err) => this.onPullError("rws", participantId, err)),
      this.fl
        .pullPending(participantId)
        .catch((err) => this.onPullError("fl-prediction", participantId, err)),
      Promise.resolve().then(() =>
        this.rounds.pullPendingRounds(participantId),
      ),
    ]);
    return { rws, flPrediction, flRounds };
  }

  private onPullError(
    kind: string,
    participantId: string,
    err: unknown,
  ): never[] {
    this.logger.error(
      `拉取 ${kind} 待办失败 participant=${participantId}: ${(err as Error).message}`,
    );
    return [];
  }

  private toSignedBatch(
    participantId: string,
    batch: Awaited<ReturnType<ConnectorTasksController["collect"]>>,
    waitMs: number,
  ): ConnectorTaskBatch {
    const sign = <T>(kind: "rws" | "fl-prediction" | "fl-round", item: T) =>
      this.signer.sign(participantId, kind, taskIdOf(kind, item), item);
    return {
      participantId,
      serverTime: new Date().toISOString(),
      waitMs,
      rws: batch.rws.map((item) => sign("rws", item)) as SignedConnectorTask[],
      flPrediction: batch.flPrediction.map((item) =>
        sign("fl-prediction", item),
      ) as SignedConnectorTask[],
      flRounds: batch.flRounds.map((item) =>
        sign("fl-round", item),
      ) as SignedConnectorTask[],
    };
  }
}

export function hasAnyTask(batch: {
  rws: unknown[];
  flPrediction: unknown[];
  flRounds: unknown[];
}): boolean {
  return (
    batch.rws.length > 0 ||
    batch.flPrediction.length > 0 ||
    batch.flRounds.length > 0
  );
}

function taskIdOf(kind: string, item: unknown): string {
  const record = item as Record<string, unknown>;
  if (kind === "fl-round") return String(record.roundTaskId ?? "");
  return String(record.assignmentId ?? "");
}
