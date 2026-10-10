import { currentSpaceId } from "../runtime/space-context/space-id.util";
import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  DigitalContractEntity,
  MdopJobEntity,
  MdopOutboxEntity,
  MdopNonceEntity,
} from "@medtrust/database";
import {
  MdopError,
  ENVELOPE_CLOCK_SKEW_MS,
  NONCE_TTL_MS,
  parseEnvelope,
  verifyCanonicalObject,
  withoutSignature,
  type Envelope,
  type MdopMessageType,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";

/**
 * MDOP 控制面消息通道（任务 7.2 / 协议 §7.1、§7.3）。
 *
 * 平台 → 连接器：消息先落 `cp_mdop_outbox`，随长轮询下发；**至少一次**投递 ——
 * 重发沿用同一 `msg_id` 与 `nonce`（首次构造后把已签名的 envelope 存回行里），
 * 连接器按 `msg_id` / `idempotency_key` 去重。
 *
 * 信封签名用**平台节点密钥**（D-MDOP-3 三钥分离）；连接器用本地固定的平台节点公钥验。
 *
 * 接收侧（连接器 → 平台）逐项校验：签名 → 收件人 → 时间窗 ±5 分钟 → nonce 未见过。
 * nonce **落盘**（`cp_mdop_nonce`），重启后仍然拦得住重放。
 */
/** 平台副署消息送出后保留多久（至少一次投递，没有接收方确认；留够连接器重取与重试的窗口）。 */
const ACK_RETENTION_MS = 10 * 60_000;

/**
 * 「大载荷」判定阈值：信封 `body` 序列化后超过它即按大载荷对待（目前只有 `C2EnvelopeRelay`
 * 会超过——它带着整份密文体，真机上约 650KB 一条）。
 */
export const LARGE_BODY_BYTES = 64 * 1024;

/**
 * 已送出的大载荷的**重投间隔**。发件箱是「至少一次」但没有接收方确认：小消息每轮重发无妨
 * （接收方重启后还要靠要约/凭证恢复内存状态），大载荷每轮重发就是事故——
 * 2026-10-07 真机上一次长轮询响应 5.2MB，且每 25 秒整批重发一遍。
 * 间隔内不重发；过了间隔还没终结才再发一次（响应中途断掉、接收方重启都靠这一条恢复）。
 */
export const LARGE_REDELIVERY_MS = 60_000;

/**
 * 单批大载荷总量上限（与入站 JSON 上限 2MB 同口径：一次响应不比一次请求大一个量级）。
 * 放不下的留到下一轮；**至少放行一条**，否则单条超限的消息永远送不出去。
 */
export const BATCH_LARGE_BYTES = 2 * 1024 * 1024;

/**
 * 执行类消息：只在作业执行期间有意义。作业一旦进入终态（成功/失败/中止），它们既不该再被执行
 * 也不该再占批次；收尾消息（`PurgeOrder` 等）与要约/凭证不在此列。
 */
const EXECUTION_MSG_TYPES: ReadonlySet<string> = new Set([
  "StageDispatch",
  "C2EnvelopeRelay",
]);

function bodyBytes(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body ?? {}));
}

@Injectable()
export class MdopOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MdopOutboxService.name);
  private readonly spaceId: string;
  private pruneTimer?: ReturnType<typeof setInterval>;

  /** 周期性清理已终结消息，保证「至少一次」通道的队列有界（见 `pruneSettled`）。 */
  onModuleInit(): void {
    void this.pruneSettled().catch(() => undefined);
    this.pruneTimer = setInterval(() => {
      void this.pruneSettled().catch((err) =>
        this.logger.warn(`发件箱清理失败：${(err as Error).message}`),
      );
    }, 30_000);
    this.pruneTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  constructor(
    private readonly gm: GMCryptoService,
    private readonly ca: CaService,
    @InjectRepository(MdopOutboxEntity, "controlplane")
    private readonly outbox: Repository<MdopOutboxEntity>,
    @InjectRepository(MdopNonceEntity, "controlplane")
    private readonly nonces: Repository<MdopNonceEntity>,
    // 清理用（可选注入：单测里只验签名/防重放的用例不必构造这两张表）
    @Optional()
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly jobs?: Repository<MdopJobEntity>,
    @Optional()
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts?: Repository<DigitalContractEntity>,
  ) {
    this.spaceId = currentSpaceId();
  }

  /** 平台节点的 URN（信封 sender/receiver 用）。 */
  platformParty(): string {
    return `urn:tds:${this.spaceId}:participant:platform`;
  }

  /**
   * 平台 → 参与方：把一条消息放进发件箱（至少一次投递，随长轮询下发）。
   *
   * 这里只做**排队**，信封在投递时构造并签名（`envelopeFor`）。幂等键相同的消息
   * 只有一行（主键 = `msg_type:幂等键`），因此「同一件事重算一遍」不会给对端发两遍。
   */
  async enqueue(input: {
    msgType: MdopMessageType;
    receiver: string;
    jobId: string;
    idempotencyKey: string;
    body: Record<string, unknown>;
  }): Promise<void> {
    await this.outbox.save(
      this.outbox.create({
        id: `${input.msgType}:${input.idempotencyKey}`,
        msg_id: randomUUID(),
        msg_type: input.msgType,
        job_id: input.jobId,
        receiver: input.receiver,
        sender: this.platformParty(),
        idempotency_key: input.idempotencyKey,
        body: input.body,
      }),
    );
  }

  /**
   * 清理**已终结**的消息：合约已生效的 `ContractOffer`/`ContractAgreeAck`、作业已进终态的
   * 全部消息。
   *
   * 为什么必须有这一步：发件箱是「至少一次」投递但**没有接收方确认**的删除通道，只增不减；
   * `pendingFor` 又按 `createdAt ASC` 取前 N 条 —— 一旦积压超过上限，**新消息永远排在
   * 第 N+1 条之后，再也发不出去**（实测踩到过：示范甲的片段要约一直收不到，作业停在
   * `NEGOTIATING`）。已终结的消息留着没有意义，删掉即可让队列有界。
   */
  async pruneSettled(): Promise<number> {
    if (!this.jobs || !this.contracts) return 0;
    // 注意：`SUCCEEDED`/`FAILED`/`ABORTED` 的作业**还要发 PurgeOrder 并等回执**，
    // 那时消息不能删；只有 `REJECTED`（从未派发、无制品）与 `PURGED`（收齐回执）是真终态。
    const pruneable = new Set(["REJECTED", "PURGED"]);
    const allJobs = await this.jobs.find();
    const terminalJobs = new Set(
      allJobs.filter((j) => pruneable.has(j.status)).map((j) => j.id),
    );
    // 作业已出执行态（成功/失败/中止，尚未 PURGED）：**执行类消息**到此为止——
    // 不该再被执行，也不该继续随批次重发（C2 信封一条约 650KB）。收尾消息照旧等回执。
    const executionOver = new Set(
      allJobs
        .filter((j) => ["SUCCEEDED", "FAILED", "ABORTED"].includes(j.status))
        .map((j) => j.id),
    );
    const settledContracts = new Set(
      (await this.contracts.find())
        .filter(
          (c) =>
            c.mdopStatus === "active" &&
            !!c.holderSignature &&
            !!c.platformCountersignature,
        )
        .map((c) => c.id),
    );

    let removed = 0;
    for (const row of await this.outbox.find()) {
      const body = row.body as { contract_id?: string } | null;
      const isContractMsg =
        row.msg_type === "ContractOffer" || row.msg_type === "ContractAgreeAck";
      // `ContractAgreeAck` 带着平台副署：平台一副署合约就「已生效」，但**持有方要收到这条消息
      // 本地副本才生效**。只按「平台侧已生效」删会把还没送出去的副署删掉（实测：副署 6 秒后
      // 被清理，连接器 25 秒的长轮询还没来取，两院本地合约永远停在 pending，片段被拒）。
      // 因此它要**送出过且留够重取窗口**才算终结；`ContractOffer` 在合约生效后已无用，可直接删。
      const ackStillNeeded =
        row.msg_type === "ContractAgreeAck" &&
        (!row.deliveredAt ||
          Date.now() - new Date(row.deliveredAt).getTime() < ACK_RETENTION_MS);
      const settled =
        (isContractMsg &&
          !ackStillNeeded &&
          !!body?.contract_id &&
          settledContracts.has(body.contract_id)) ||
        (!!row.job_id && terminalJobs.has(row.job_id)) ||
        (!!row.job_id &&
          executionOver.has(row.job_id) &&
          EXECUTION_MSG_TYPES.has(row.msg_type));
      if (!settled) continue;
      await this.outbox.delete({ id: row.id });
      removed += 1;
    }
    if (removed) this.logger.log(`发件箱清理：删除 ${removed} 条已终结消息`);
    return removed;
  }

  /**
   * 撤回同一来源的**旧** C2 信封：同一作业、同一持有方、同一目标节点，发件箱里只留最新一份。
   *
   * 「密钥 + 目标」的幂等键只挡得住同一份信封的重复提交；持有方**重封**（换了密钥）时它是
   * 另一条行。节点对同一持有方只收一份、其余按 `E_ENVELOPE_POLICY` 拒，但每一轮仍要把全部
   * 下载一遍——所以旧的必须在平台侧撤掉，而不是指望接收方丢弃。
   */
  async withdrawSupersededRelays(input: {
    jobId: string;
    receiver: string;
    holder: string;
    /** 即将入箱的那一行（同一份信封重复提交时不能把它自己撤掉）。 */
    keepId: string;
  }): Promise<number> {
    const rows = await this.outbox.find({
      where: {
        job_id: input.jobId,
        msg_type: "C2EnvelopeRelay",
        receiver: input.receiver,
      },
    });
    let removed = 0;
    for (const row of rows) {
      if (row.id === input.keepId) continue;
      if ((row.body as { holder?: string } | null)?.holder !== input.holder)
        continue;
      await this.outbox.delete({ id: row.id });
      removed += 1;
    }
    if (removed)
      this.logger.warn(
        `C2 信封被顶替 job=${input.jobId} holder=${input.holder} → ${input.receiver}：撤回旧信封 ${removed} 份（持有方重封过）`,
      );
    return removed;
  }

  /**
   * 取该节点待下发的消息（至少一次：未终结的消息会重发，接收方按 `msg_id` / 幂等键去重）。
   * 重发复用已存 envelope 的 `msg_id` / `nonce`。
   *
   * **批次有界**（2026-10-07 事故后补）：
   *  - 小消息每轮都带（接收方的已复核片段与凭证只在内存里，重启后要靠重发恢复）；
   *  - 大载荷（> {@link LARGE_BODY_BYTES}）送出后在 {@link LARGE_REDELIVERY_MS} 内不重发全文；
   *  - 单批大载荷总量不超过 {@link BATCH_LARGE_BYTES}，放不下的留到下一轮（小消息不被它挡住）。
   * 「不再需要」的消息不靠这里兜：指令被状态应答即撤回（调度器）、作业终态即清理（`pruneSettled`）。
   */
  async pendingFor(
    receiver: string,
    limit = 200,
    now: Date = new Date(),
  ): Promise<Envelope[]> {
    const rows = await this.outbox.find({
      where: { receiver },
      order: { createdAt: "ASC" },
      take: limit,
    });
    const envelopes: Envelope[] = [];
    let largeBytes = 0;
    let held = 0;
    for (const row of rows) {
      const size = bodyBytes(row.body);
      if (size > LARGE_BODY_BYTES) {
        const sinceDelivery = row.deliveredAt
          ? now.getTime() - new Date(row.deliveredAt).getTime()
          : Number.POSITIVE_INFINITY;
        // 负值 = 时钟回拨：按「已到期」处理（宁可多发一次，不让一条消息被回拨的时钟压住不发）
        if (sinceDelivery >= 0 && sinceDelivery < LARGE_REDELIVERY_MS) continue;
        if (largeBytes > 0 && largeBytes + size > BATCH_LARGE_BYTES) {
          held += 1;
          continue;
        }
        largeBytes += size;
      }
      envelopes.push(await this.envelopeFor(row, now));
    }
    if (held)
      this.logger.warn(
        `发件箱批次已到大载荷上限（${largeBytes} 字节）：${receiver} 还有 ${held} 条留到下一轮`,
      );
    return envelopes;
  }

  /**
   * 构造**本次投递**的信封。
   *
   * 关键：时间戳必须**每次投递都是新的**，而 `msg_id` 与 `nonce` 复用第一次的值。
   *  - `msg_id` / `nonce` 是去重与防重放的身份（至少一次投递下，连接器按它们识别重复）；
   *  - 时间戳反映这一次投递，否则一条迟迟未被确认的消息会带着旧时间戳重发，
   *    一旦超过接收方 ±5 分钟窗口就**永远送不达**（实测踩到过：合约要约卡在发件箱）。
   */
  async envelopeFor(
    row: MdopOutboxEntity,
    now: Date = new Date(),
  ): Promise<Envelope> {
    const previous = (row.envelope as unknown as Envelope) ?? undefined;
    const unsigned = {
      mdop: "0.2",
      msg_id: row.msg_id,
      msg_type: row.msg_type as MdopMessageType,
      job_id: row.job_id ?? "",
      sender: row.sender,
      receiver: row.receiver,
      timestamp: now.toISOString(),
      // 重发沿用首次的 nonce（防重放身份不变），首次投递才生成
      nonce: previous?.nonce ?? randomUUID(),
      idempotency_key: row.idempotency_key,
      body: row.body,
    };
    // 签名内容 = 去掉 sig 的信封（JCS + SM3），由平台节点密钥签。
    const sig = this.ca.signObjectWith("platform-node", unsigned);
    const envelope = { ...unsigned, sig } as unknown as Envelope;
    await this.outbox.update(
      { id: row.id },
      {
        envelope: envelope as unknown as Record<string, unknown>,
        deliveredAt: now,
      },
    );
    return envelope;
  }

  /**
   * 校验连接器发来的信封。失败抛 `MdopError`（`E_AUTH_INVALID` / `E_REPLAY`），
   * 调用方 MUST NOT 执行消息内容。
   */
  async verifyInbound(
    envelope: Envelope,
    senderPublicKey: string,
    now: Date = new Date(),
  ): Promise<Envelope> {
    const unsigned = parseEnvelope(envelope);
    const sig = envelope.sig;
    if (!sig || sig.alg !== "SM2-SM3")
      throw new MdopError("E_AUTH_INVALID", {}, "算法不是 SM2-SM3");
    if (sig.kid !== this.gm.publicKeyKid(senderPublicKey))
      throw new MdopError("E_AUTH_INVALID", {}, "kid 与发送方登记公钥不符");
    if (
      !verifyCanonicalObject(
        withoutSignature(unsigned as never),
        sig,
        senderPublicKey,
      )
    )
      throw new MdopError("E_AUTH_INVALID", {}, "信封签名无效");
    if (unsigned.receiver !== this.platformParty())
      throw new MdopError("E_AUTH_INVALID", {}, "收件人不是平台");
    const skew = Math.abs(now.getTime() - Date.parse(unsigned.timestamp));
    if (!Number.isFinite(skew) || skew > ENVELOPE_CLOCK_SKEW_MS)
      throw new MdopError("E_AUTH_INVALID", {}, "时间偏差超出窗口");

    // nonce 落盘：重启后仍拦得住重放
    const existing = await this.nonces.findOne({
      where: { nonce: unsigned.nonce },
    });
    if (existing && new Date(existing.expiresAt).getTime() >= now.getTime())
      throw new MdopError("E_REPLAY");
    await this.nonces.save(
      this.nonces.create({
        nonce: unsigned.nonce,
        receiver: unsigned.receiver,
        sender: unsigned.sender,
        expiresAt: new Date(now.getTime() + NONCE_TTL_MS),
      }),
    );
    return envelope;
  }

  /** 清理过期 nonce 行（单实例 WAL，量小）。 */
  async sweepNonces(now: Date = new Date()): Promise<number> {
    const rows = await this.nonces.find();
    let removed = 0;
    for (const row of rows) {
      if (new Date(row.expiresAt).getTime() >= now.getTime()) continue;
      await this.nonces.delete({ nonce: row.nonce });
      removed += 1;
    }
    if (removed) this.logger.debug(`清理过期 nonce ${removed} 条`);
    return removed;
  }
}
