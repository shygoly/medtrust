import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DigitalContractEntity,
  FlPredictionTaskEntity,
  MdopAttestationEntity,
  MdopReceiptEntity,
  RwsTaskEntity,
} from "@medtrust/database";
import {
  AttestationLedgerEntry,
  AttestationLedgerService,
} from "./attestation-ledger.service";

interface StoredReceipt {
  txHash?: unknown;
  block?: unknown;
  hash?: unknown;
}

/**
 * 历史回填：把账本上线**之前**各域自己存下的真实链上回执补进存证指针账本。
 *
 * 为什么需要：`cp_attestation_ref` 此前从未被写入，回执只散落在各域的表里
 * （RWS 任务的 merged、合约的 attestationTxHash、MDOP 回执链锚定、节点证明登记）。
 * 不回填，账本页在下一次新存证之前仍然是空的，重复哈希也找不回早先的交易号。
 *
 * 启动时跑一次，幂等（账本按「哈希 + 归属对象」去重）。只收真实交易号：本地降级回执
 * （`0xLOCAL:`）与待补锚项一律跳过——由账本的 `record` 把关。
 *
 * 未覆盖：RBQM 越限存证（表里没存证据哈希）与 SecretFlow 任务（回执不落控制面库）。
 * 这两类自本次起由 AttestationService 上链成功时直接入账本。
 */
@Injectable()
export class AttestationLedgerBackfillService implements OnModuleInit {
  private readonly logger = new Logger(AttestationLedgerBackfillService.name);

  constructor(
    private readonly ledger: AttestationLedgerService,
    @InjectRepository(RwsTaskEntity, "controlplane")
    private readonly rwsTasks: Repository<RwsTaskEntity>,
    @InjectRepository(FlPredictionTaskEntity, "controlplane")
    private readonly flTasks: Repository<FlPredictionTaskEntity>,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
    @InjectRepository(MdopReceiptEntity, "controlplane")
    private readonly mdopReceipts: Repository<MdopReceiptEntity>,
    @InjectRepository(MdopAttestationEntity, "controlplane")
    private readonly mdopAttestations: Repository<MdopAttestationEntity>,
  ) {}

  /** 回填失败不得挡住启动：账本是读模型，缺历史只影响展示，不影响存证本身。 */
  async onModuleInit(): Promise<void> {
    try {
      const imported = await this.backfill();
      if (imported > 0)
        this.logger.log(`存证指针账本回填 ${imported} 条历史链上记录`);
    } catch (err) {
      this.logger.warn(`存证指针账本回填失败: ${(err as Error).message}`);
    }
  }

  /** 返回本次新入账本的条数。 */
  async backfill(): Promise<number> {
    const before = await this.ledger.count();
    for (const entry of await this.collect()) await this.ledger.record(entry);
    return (await this.ledger.count()) - before;
  }

  private async collect(): Promise<AttestationLedgerEntry[]> {
    const out: AttestationLedgerEntry[] = [];

    for (const task of await this.rwsTasks.find()) {
      const merged = (task.merged ?? {}) as Record<string, any>;
      // 一个任务只会走其中一条合并路径；三处形状不同，逐一取（与 toOrchestrationRecord 同源）。
      const receipts: StoredReceipt[] = [
        merged.attestation,
        merged.metaPooled?.attestation,
        merged.l0Validation?.attestation,
      ];
      for (const receipt of receipts)
        this.push(out, receipt, {
          kind: "output",
          subjectType: "rws-task",
          subjectId: task.taskId,
          anchoredAt: iso(task.completedAt),
        });
    }

    for (const task of await this.flTasks.find()) {
      const att = ((task.merged ?? {}) as Record<string, any>).attestation as
        Record<string, unknown> | undefined;
      this.push(
        out,
        att && {
          hash: att.reportHash,
          txHash: att.chainTxHash,
          block: att.chainBlock,
        },
        {
          kind: "output",
          subjectType: "fl-task",
          subjectId: task.taskId,
          anchoredAt: iso(att?.generatedAt) ?? iso(task.completedAt),
        },
      );
    }

    for (const contract of await this.contracts.find()) {
      this.push(
        out,
        {
          hash: contract.hash,
          txHash: contract.attestationTxHash,
          block: contract.attestationBlock,
        },
        {
          kind: "policy",
          subjectType: "contract",
          subjectId: contract.id,
          anchoredAt: iso(contract.attestedAt),
        },
      );
    }

    for (const row of await this.mdopReceipts.find({
      where: { kind: "anchor" },
    })) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      if (payload.status !== "anchored") continue; // pending = 待补锚，没有交易号
      this.push(
        out,
        {
          hash: payload.chain_head,
          txHash: payload.tx_id,
          block: payload.block,
        },
        {
          kind: "receipt-chain",
          subjectType: "mdop-job",
          subjectId: row.jobId,
          anchoredAt: iso(payload.at) ?? iso(row.receivedAt),
        },
      );
    }

    for (const row of await this.mdopAttestations.find()) {
      this.push(
        out,
        { hash: row.quoteDigest, txHash: row.chainTx, block: row.chainBlock },
        {
          kind: "node-attestation",
          ...(row.jobId
            ? { subjectType: "mdop-job" as const, subjectId: row.jobId }
            : {}),
          anchoredAt: iso(row.createdAt),
        },
      );
    }

    return out;
  }

  /** 回执三要素（哈希 / 交易号 / 区块）齐全才算一条可回填的记录。 */
  private push(
    out: AttestationLedgerEntry[],
    receipt: StoredReceipt | undefined | null | false,
    subject: Omit<AttestationLedgerEntry, "hash" | "txHash" | "block">,
  ): void {
    if (!receipt) return;
    const { hash, txHash, block } = receipt;
    if (typeof hash !== "string" || !hash) return;
    if (typeof txHash !== "string" || !txHash) return;
    const height = Number(block);
    if (!Number.isFinite(height)) return;
    out.push({ ...subject, hash, txHash, block: height });
  }
}

function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
