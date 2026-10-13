import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SETTLEMENT_RECORDS } from "@medtrust/demo-scenario";
import { SettlementRecord as SettlementRecordEntity } from "@medtrust/database";
import type { MeteringMeasurement } from "@medtrust/space-kernel-spi";
import { SpaceContextService } from "../space-context/space-context.service";
import {
  rowVisibleInSpace,
  spaceIdForWrite,
} from "../space-context/space-visibility";

export interface SettlementLine {
  org: string;
  participantId: string;
  contribution: number;
  amount: number;
}

export interface SettlementRecord {
  id: string;
  taskId: string;
  taskRef: string; // task attestation hash
  consumer: string;
  consumerId: string;
  currency: string;
  contributionTotal: number;
  total: number;
  lines: SettlementLine[];
  hash: string;
  at: string;
  /**
   * P3.2 / D-SPD-7：贡献度由哪个计量引擎产出。
   * mode = proxy = 开放兜底口径（无闭源估值插件时的如实标注）。
   */
  meteringEngine?: {
    id: string;
    version: string;
    digest: string;
    mode: "authoritative" | "proxy";
  };
}

// 价值共创结算台账(控制面)。按角色控权查询:提供方见自身收益、使用方见自身
// 费用、运营方见全局(value-settlement 10.5)。持久化在 control-plane 库(append-only)。
@Injectable()
export class SettlementService implements OnModuleInit {
  constructor(
    @InjectRepository(SettlementRecordEntity, "controlplane")
    private readonly repo: Repository<SettlementRecordEntity>,
    @Optional() private readonly spaces?: SpaceContextService,
  ) {}

  // 幂等种子(以 record id 为自然键)。
  async onModuleInit(): Promise<void> {
    for (const rec of SETTLEMENT_RECORDS) {
      if (await this.repo.findOne({ where: { id: rec.id } })) continue;
      await this.record(rec);
    }
  }

  // 写入一条结算台账(含按贡献分账明细;cascade 持久化 lines)。
  async record(rec: SettlementRecord): Promise<void> {
    await this.repo.save(
      this.repo.create({
        ...rec,
        spaceId: spaceIdForWrite(this.spaces?.current()?.spaceId),
        meteringEngine: (rec.meteringEngine ?? null) as never,
      }),
    );
  }

  /**
   * P3.2：带计量引擎标注写入台账。
   * 调用方 MUST 传入真实 measurement（可以是开放兜底口径），
   * 由引擎自带的 mode 决定标注，**不得由调用方自报**（D-SPD-7）。
   */
  async recordMeasured(
    rec: Omit<SettlementRecord, "meteringEngine">,
    measurement: MeteringMeasurement,
  ): Promise<void> {
    await this.record({ ...rec, meteringEngine: { ...measurement.engine } });
  }

  // Role-gated view. provider → records they earned in, only their own line;
  // consumer → records they paid for; operator/compliance → everything.
  async list(user: { role?: string; participantId?: string }): Promise<any[]> {
    const all = (await this.repo.find()).filter((row) =>
      rowVisibleInSpace(row, this.spaces?.current()?.spaceId),
    );
    if (user.role === "operator" || user.role === "compliance") return all;

    if (user.role === "provider") {
      return all
        .filter((r) =>
          r.lines.some((l) => l.participantId === user.participantId),
        )
        .map((r) => ({
          id: r.id,
          taskId: r.taskId,
          taskRef: r.taskRef,
          currency: r.currency,
          at: r.at,
          // only this provider's own earning line is visible
          earning: r.lines.find((l) => l.participantId === user.participantId),
        }));
    }

    if (user.role === "consumer") {
      return all.filter((r) => r.consumerId === user.participantId);
    }
    return [];
  }

  async consumerOwnsTask(taskId: string, consumerId: string): Promise<boolean> {
    const hit = await this.repo.findOne({ where: { taskId, consumerId } });
    return !!hit;
  }
}
