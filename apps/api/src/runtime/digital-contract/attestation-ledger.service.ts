import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AttestationLevel,
  AttestationRef,
  AttestationRefKind,
  AttestationSubjectType,
  DigitalContractEntity,
  FlPredictionAssignmentEntity,
  FlPredictionTaskEntity,
  MdopJobEntity,
  RwsAssignmentEntity,
  RwsTaskEntity,
} from "@medtrust/database";
import { participantMatches } from "./participant-aliases";

/** 本次存证归属哪个对象（决定账本里的类别，以及哪些参与方有权看到它）。 */
export interface AttestationSubject {
  kind: AttestationRefKind;
  subjectType?: AttestationSubjectType;
  subjectId?: string;
}

export interface AttestationLedgerEntry extends AttestationSubject {
  hash: string;
  txHash: string;
  block: number;
  /** 上链时间(ISO)；缺省取登记时刻。 */
  anchoredAt?: string;
  attestationLevel?: AttestationLevel;
}

/** 账本接口对外的一行：类别 / 哈希 / 交易号 / 区块 / 时间 + 归属对象。 */
export interface AttestationLedgerRow {
  id: string;
  kind: AttestationRefKind;
  hash: string;
  txHash: string;
  block: number;
  anchoredAt: string;
  subjectType: AttestationSubjectType | null;
  subjectId: string | null;
  attestationLevel: AttestationLevel;
}

export interface LedgerViewer {
  role?: string;
  participantId?: string;
}

/** 降级本地回执的交易号前缀（见 AttestationService）：不是链上交易，MUST NOT 入账本。 */
export const LOCAL_RECEIPT_PREFIX = "0xLOCAL:";

/** 全量可见的角色：平台运营、合规审计、平台管理员。其余角色只见自己参与的对象。 */
const LEDGER_WIDE_ROLES = new Set(["operator", "compliance", "admin"]);
const PARTICIPANT_ROLES = new Set(["provider", "consumer"]);

/**
 * 哈希的规范形 `SM3:<小写 hex>`。各调用方的前缀口径不一（RWS 用 `SM3:`、MDOP 用 `sm3:`、
 * 链侧是裸 hex），账本必须按同一个键存取，否则「按哈希找回既有记录」会漏。
 */
export function normalizeAttestationHash(hash: string): string {
  return "SM3:" + hash.replace(/^sm3:/i, "").toLowerCase();
}

/**
 * 存证指针账本（`cp_attestation_ref`）。
 *
 * 只收**真实上链**的记录：`AttestationService` 每次上链成功后写一条，
 * 存证账本页、审计证据包与「重复哈希找回既有记录」都读这里。
 */
@Injectable()
export class AttestationLedgerService {
  constructor(
    @InjectRepository(AttestationRef, "controlplane")
    private readonly refs: Repository<AttestationRef>,
    @InjectRepository(RwsTaskEntity, "controlplane")
    private readonly rwsTasks: Repository<RwsTaskEntity>,
    @InjectRepository(RwsAssignmentEntity, "controlplane")
    private readonly rwsAssignments: Repository<RwsAssignmentEntity>,
    @InjectRepository(FlPredictionTaskEntity, "controlplane")
    private readonly flTasks: Repository<FlPredictionTaskEntity>,
    @InjectRepository(FlPredictionAssignmentEntity, "controlplane")
    private readonly flAssignments: Repository<FlPredictionAssignmentEntity>,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
    @InjectRepository(MdopJobEntity, "controlplane")
    private readonly mdopJobs: Repository<MdopJobEntity>,
  ) {}

  /**
   * 登记一条链上存证指针。按 (hash, 归属对象) 幂等；降级本地回执与空交易号一律不收
   * （返回 null）——账本里出现的每一行都必须真在链上。
   */
  async record(entry: AttestationLedgerEntry): Promise<AttestationRef | null> {
    if (!entry.txHash || entry.txHash.startsWith(LOCAL_RECEIPT_PREFIX)) {
      return null;
    }
    const hash = normalizeAttestationHash(entry.hash);
    const existing = await this.findPointer(hash, entry);
    if (existing) return existing;
    return this.refs.save(
      this.refs.create({
        hash,
        kind: entry.kind,
        subjectType: entry.subjectType ?? null,
        taskId: entry.subjectId ?? null,
        attestationLevel: entry.attestationLevel ?? "software",
        txHash: entry.txHash,
        block: String(entry.block),
        outputHash: entry.kind === "output" ? hash : null,
        anchoredAt: entry.anchoredAt ?? new Date().toISOString(),
      }),
    );
  }

  /**
   * 该对象是否已有指向这条哈希的指针。用于区分「同一对象幂等重锚自己的记录」与
   * 「另一个对象算出了相同的哈希」；归属不明（没有对象 id）的一律不算。
   */
  async hasPointer(
    hash: string,
    subject: Pick<AttestationSubject, "subjectType" | "subjectId">,
  ): Promise<boolean> {
    if (!subject.subjectId) return false;
    return !!(await this.findPointer(normalizeAttestationHash(hash), subject));
  }

  private async findPointer(
    normalizedHash: string,
    subject: Pick<AttestationSubject, "subjectType" | "subjectId">,
  ): Promise<AttestationRef | undefined> {
    const subjectType = subject.subjectType ?? null;
    const taskId = subject.subjectId ?? null;
    const sameHash = await this.refs.find({ where: { hash: normalizedHash } });
    return sameHash.find(
      (r) =>
        (r.subjectType ?? null) === subjectType &&
        (r.taskId ?? null) === taskId,
    );
  }

  /** 账本内的指针条数。 */
  count(): Promise<number> {
    return this.refs.count();
  }

  /** 按哈希找回既有的链上记录（同一哈希的多条指针指向同一笔交易，取任一条）。 */
  async findByHash(hash: string): Promise<AttestationRef | null> {
    const rows = await this.refs.find({
      where: { hash: normalizeAttestationHash(hash) },
    });
    return rows[0] ?? null;
  }

  /**
   * 账本列表，按角色控权：运营 / 合规 / 管理员见全部；提供方、使用方只见自己参与的
   * 任务、作业与合约的存证；身份不明一律为空（fail-closed）。
   */
  async list(viewer: LedgerViewer): Promise<AttestationLedgerRow[]> {
    const role = viewer.role ?? "";
    if (!LEDGER_WIDE_ROLES.has(role)) {
      if (!PARTICIPANT_ROLES.has(role) || !viewer.participantId) return [];
    }
    const all = await this.refs.find();
    const visible = LEDGER_WIDE_ROLES.has(role)
      ? all
      : await this.filterForParticipant(all, viewer.participantId as string);
    return visible
      .map((r) => this.toRow(r))
      .sort((a, b) => b.anchoredAt.localeCompare(a.anchoredAt));
  }

  private async filterForParticipant(
    rows: AttestationRef[],
    participantId: string,
  ): Promise<AttestationRef[]> {
    const subjects = await this.subjectsOf(participantId);
    return rows.filter(
      (r) =>
        !!r.subjectType &&
        !!r.taskId &&
        subjects.has(`${r.subjectType}:${r.taskId}`),
    );
  }

  /**
   * 该参与方作为使用方或提供方参与的对象集合，形如 `rws-task:<id>`。
   * 参与方标识按 `participantMatches` 比对（种子数据里可能是 slug 或机构显示名），
   * 与合约列表的控权口径一致。
   */
  private async subjectsOf(participantId: string): Promise<Set<string>> {
    const mine = (partyId?: string | null) =>
      !!partyId && participantMatches(participantId, partyId);
    const out = new Set<string>();

    const contractIds = new Set<string>();
    for (const c of await this.contracts.find()) {
      if (!mine(c.providerId) && !mine(c.consumerId)) continue;
      contractIds.add(c.id);
      out.add(`contract:${c.id}`);
    }

    const [rwsTasks, rwsAssignments, flTasks, flAssignments] =
      await Promise.all([
        this.rwsTasks.find(),
        this.rwsAssignments.find(),
        this.flTasks.find(),
        this.flAssignments.find(),
      ]);
    for (const t of rwsTasks)
      if (mine(t.consumerId)) out.add(`rws-task:${t.taskId}`);
    for (const a of rwsAssignments)
      if (mine(a.providerId)) out.add(`rws-task:${a.taskId}`);
    for (const t of flTasks)
      if (mine(t.consumerId)) out.add(`fl-task:${t.taskId}`);
    for (const a of flAssignments)
      if (mine(a.providerId)) out.add(`fl-task:${a.taskId}`);

    // MDOP 作业没有直接的参与方列：按作业引用的合约判定（合约的提供方 / 使用方即作业当事方）。
    if (contractIds.size > 0) {
      for (const job of await this.mdopJobs.find()) {
        if ((job.contracts ?? []).some((id) => contractIds.has(id)))
          out.add(`mdop-job:${job.id}`);
      }
    }
    return out;
  }

  private toRow(r: AttestationRef): AttestationLedgerRow {
    return {
      id: r.id,
      kind: r.kind,
      hash: r.hash,
      txHash: r.txHash,
      block: Number(r.block),
      anchoredAt: r.anchoredAt ?? new Date(r.at).toISOString(),
      subjectType: r.subjectType ?? null,
      subjectId: r.taskId ?? null,
      attestationLevel: r.attestationLevel,
    };
  }
}
