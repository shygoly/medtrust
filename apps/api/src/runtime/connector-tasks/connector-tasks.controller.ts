import { currentSpaceId } from "../space-context/space-id.util";
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
import {
  ConnectorTaskBatch,
  ModuleRevocationList,
  SignedConnectorTask,
} from "./types";
import { ModuleAdmissionService } from "../connector-modules/module-admission.service";
import { MdopOperatorRegistryService } from "../../mdop/operator-registry.service";
import { MdopRevocationService } from "../../mdop/revocation.service";
import { MdopOutboxService } from "../../mdop/mdop-outbox.service";
import { DeidSpecService } from "../deid-spec/deid-spec.service";
import { DeidDictionaryService } from "../deid-spec/deid-dictionary.service";
import { participantUrn } from "@medtrust/mdop";

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
    /** third-party-module-admission 闸 5：随批次下发吊销名单。 */
    private readonly moduleAdmission: ModuleAdmissionService,
    /** mdop-kernel：算子清单（注册中心密钥签）与 MDOP 吊销名单（平台节点密钥签）。 */
    private readonly mdopOperators: MdopOperatorRegistryService,
    private readonly mdopRevocations: MdopRevocationService,
    private readonly mdopOutbox: MdopOutboxService,
    /** connector-agent-deidentification：脱敏规格与吊销名单随批次下发。 */
    private readonly deidSpecs: DeidSpecService,
    /** Phase 2：脱敏词表**清单**（摘要背书）与吊销名单。 */
    private readonly deidDictionaries: DeidDictionaryService,
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
      return this.toSignedBatch(
        participantId,
        batch,
        waitMs,
        await this.revocations(),
        await this.mdopRegistryPayload(),
        await this.mdopRevocationPayload(),
        await this.mdopMessages(participantId),
        await this.deidPayload(),
        await this.deidDictionaryPayload(),
      );
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

  /** 吊销名单取不到不得当成「无吊销」——如实留空，由连接器按部署策略处置。 */
  private async revocations(): Promise<ModuleRevocationList | undefined> {
    try {
      return await this.moduleAdmission.revocationList();
    } catch (err) {
      this.logger.error(`吊销名单读取失败：${(err as Error).message}`);
      return undefined;
    }
  }

  private toSignedBatch(
    participantId: string,
    batch: Awaited<ReturnType<ConnectorTasksController["collect"]>>,
    waitMs: number,
    revocations?: ModuleRevocationList,
    mdopOperators?: ConnectorTaskBatch["mdopOperators"],
    mdopRevocations?: ConnectorTaskBatch["mdopRevocations"],
    mdop?: ConnectorTaskBatch["mdop"],
    deid?: {
      deidSpecs: ConnectorTaskBatch["deidSpecs"];
      deidRevocations: ConnectorTaskBatch["deidRevocations"];
    },
    deidDictionaries?: {
      deidDictionaries: ConnectorTaskBatch["deidDictionaries"];
      deidDictionaryRevocations: ConnectorTaskBatch["deidDictionaryRevocations"];
    },
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
      ...(revocations ? { revocations } : {}),
      ...(mdopOperators ? { mdopOperators } : {}),
      ...(mdopRevocations ? { mdopRevocations } : {}),
      ...(mdop && mdop.length ? { mdop } : {}),
      ...(deid?.deidSpecs?.length ? { deidSpecs: deid.deidSpecs } : {}),
      ...(deid?.deidRevocations && deid.deidRevocations.version > 0
        ? { deidRevocations: deid.deidRevocations }
        : {}),
      ...(deidDictionaries?.deidDictionaries?.length
        ? { deidDictionaries: deidDictionaries.deidDictionaries }
        : {}),
      ...(deidDictionaries?.deidDictionaryRevocations &&
      deidDictionaries.deidDictionaryRevocations.version > 0
        ? {
            deidDictionaryRevocations:
              deidDictionaries.deidDictionaryRevocations,
          }
        : {}),
    };
  }

  /**
   * connector-agent-deidentification：脱敏规格包 + 吊销名单。
   * 取不到就不带字段 —— 连接器不会把「拿不到规格」当成「不需要脱敏」。
   */
  private async deidPayload(): Promise<
    | {
        deidSpecs: ConnectorTaskBatch["deidSpecs"];
        deidRevocations: ConnectorTaskBatch["deidRevocations"];
      }
    | undefined
  > {
    try {
      return await this.deidSpecs.connectorBatchPayload();
    } catch (err) {
      this.logger.error(`脱敏规格读取失败：${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * Phase 2：脱敏词表清单 + 吊销名单。取不到就不带字段 ——
   * 引用词表的规格在连接器侧随之 fail-closed，不会被当成「不需要词表」。
   */
  private async deidDictionaryPayload(): Promise<
    | {
        deidDictionaries: ConnectorTaskBatch["deidDictionaries"];
        deidDictionaryRevocations: ConnectorTaskBatch["deidDictionaryRevocations"];
      }
    | undefined
  > {
    try {
      const [deidDictionaries, deidDictionaryRevocations] = await Promise.all([
        this.deidDictionaries.activeManifests(),
        this.deidDictionaries.revocationList(),
      ]);
      return { deidDictionaries, deidDictionaryRevocations };
    } catch (err) {
      this.logger.error(`脱敏词表清单读取失败：${(err as Error).message}`);
      return undefined;
    }
  }

  /** 平台 → 连接器的 MDOP 消息（发件箱；至少一次）。取不到就不带字段。 */
  private async mdopMessages(
    participantId: string,
  ): Promise<ConnectorTaskBatch["mdop"]> {
    try {
      const receiver = participantUrn(currentSpaceId(), participantId);
      const envelopes = await this.mdopOutbox.pendingFor(receiver);
      return envelopes as unknown as ConnectorTaskBatch["mdop"];
    } catch (err) {
      this.logger.error(`MDOP 发件箱读取失败：${(err as Error).message}`);
      return undefined;
    }
  }

  /** 算子清单取不到 → 不带字段（连接器按 fail-closed 处置：没有清单就不复核/执行）。 */
  private async mdopRegistryPayload(): Promise<
    ConnectorTaskBatch["mdopOperators"]
  > {
    try {
      return await this.mdopOperators.manifestPayload();
    } catch (err) {
      this.logger.error(`算子清单读取失败：${(err as Error).message}`);
      return undefined;
    }
  }

  /** 吊销名单取不到 → 不带字段（连接器保持 fail-closed：宁可拒执行，不当作「无吊销」）。 */
  private async mdopRevocationPayload(): Promise<
    ConnectorTaskBatch["mdopRevocations"]
  > {
    try {
      return (await this.mdopRevocations.signedList()) ?? undefined;
    } catch (err) {
      this.logger.error(`MDOP 吊销名单读取失败：${(err as Error).message}`);
      return undefined;
    }
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
