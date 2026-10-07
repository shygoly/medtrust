import { Injectable, Logger, Optional } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  ChainAdapter,
  ChainTxRevertedError,
} from "../../blockchain/adapters/chain.adapter";
import { AttestationLevel, DigitalContract } from "@medtrust/database";
import {
  AttestationLedgerService,
  AttestationSubject,
  LOCAL_RECEIPT_PREFIX,
} from "./attestation-ledger.service";

/**
 * 本地降级回执的原因（如实标注，仅 `txHash` 为 `0xLOCAL:` 前缀时有）：
 *  - `no-chain-adapter`     未装配链适配器（单测 / 无链部署）
 *  - `chain-unavailable`    链或 sidecar 不可达
 *  - `chain-rejected`       交易回滚，且链上**没有**这条哈希（或问不到链）
 *  - `duplicate-unresolved` 链上**已有**这条哈希，但找不回它的交易号——不编造交易号
 */
export type AttestationDegradeReason =
  | "no-chain-adapter"
  | "chain-unavailable"
  | "chain-rejected"
  | "duplicate-unresolved";

export interface AttestationReceipt {
  txHash: string;
  block: number;
  hash: string; // the SM3 digest that was anchored
  attestationLevel: AttestationLevel; // D-RWS-4: 硬件 TEE 接入前恒 software
  /** on-chain-provider-endorsement:随本次存证上链的各院背书(供界面/独立核验回显)。 */
  endorsements?: ProviderEndorsementMetadata[];
  /**
   * true = 这条哈希此前已由**别的对象**上链：本次没有产生新交易，`txHash` / `block` 是那条
   * 既有记录的。同一对象幂等重锚自己的哈希不标（回带的本来就是它自己的记录）。
   * 两种情形都不回带 `endorsements`——本次的背书没有上链（链上那份是首次存证时的）。
   */
  reused?: boolean;
  /** 上链时间(ISO)。`reused` 时是既有记录的时间(若能找回)。 */
  anchoredAt?: string;
  /** 降级为本地回执的原因；真实上链的回执没有这个字段。 */
  degraded?: AttestationDegradeReason;
}

/**
 * on-chain-provider-endorsement(D2)——贡献方连接器对其结果摘要的 SM2 背书。
 * 上链后可脱离平台核验:平台 CA 公钥验证书链 → 连接器证书公钥验签。
 */
export interface ProviderEndorsementMetadata {
  participantId: string;
  resultSm3: string;
  sig: string;
  certFingerprint: string;
}

/** 随存证一起上链的附加元数据(哈希仍在 data_hash,元数据只为可读追溯)。 */
export interface AttestationMetadata {
  executionIsolation?: string;
  moduleSm3?: string[];
  /** 按贡献方的连接器背书(多院任务一院一条)。 */
  endorsements?: ProviderEndorsementMetadata[];
  [key: string]: unknown;
}

export interface AttestationVerification {
  valid: boolean;
  chain?: {
    dataHash: string;
    timestamp: number;
    signer: string;
  } | null;
}

// 策略哈希上链存证(usage-control 4.3). The chain stores ONLY the hash (D6).
// Real anchoring goes through the ChainMaker sidecar via ChainAdapter; if the
// chain is unreachable this falls back to a local receipt so the orchestration
// is not blocked, but logs the degradation. Every real on-chain anchor is also
// written to the attestation ledger (cp_attestation_ref).
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);
  private localBlock = 1_840_000;
  private readonly attestationLevel: AttestationLevel = "software";

  constructor(
    private readonly gm: GMCryptoService,
    @Optional() private readonly chainAdapter?: ChainAdapter,
    @Optional() private readonly ledger?: AttestationLedgerService,
  ) {}

  attestContract(contract: DigitalContract): Promise<AttestationReceipt> {
    const hash =
      contract.hash ?? "SM3:" + this.gm.sm3Hash(JSON.stringify(contract));
    return this.anchor(hash, undefined, {
      kind: "policy",
      subjectType: "contract",
      subjectId: contract.id,
    });
  }

  /**
   * Anchor a precomputed digest on-chain. When a real ChainAdapter is wired
   * (production), this submits to the ChainMaker sidecar and returns the real
   * txHash + block.
   *
   * 链上合约对同一哈希只收一条。确定性计算会算出与历史记录相同的哈希，这时合约回滚
   * （`Attestation already exists`）——那**不是**存证失败：哈希就在链上。此时找回并返回
   * **既有的**链上记录（`reused: true`），不降级。
   *
   * 其它失败（链不可达、别的回滚原因、找不回既有交易号）照旧降级为确定性的本地回执，
   * 结果不丢；调用方凭 txHash 前缀（`0xLOCAL:`）与 `degraded` 原因区分。
   *
   * `subject` 说明这条存证归属哪个对象，只进账本、**不进链上 payload**。
   */
  async anchor(
    hash: string,
    extraMetadata?: AttestationMetadata,
    subject?: AttestationSubject,
  ): Promise<AttestationReceipt> {
    const ref: AttestationSubject = subject ?? { kind: "output" };
    let degraded: AttestationDegradeReason = "no-chain-adapter";
    if (this.chainAdapter) {
      // The "SM3:" prefix is an internal convention; the chain sidecar
      // expects a bare hex digest. Strip the prefix so the Java SDK doesn't
      // choke parsing "SM3:…" as a hex string.
      const hexHash = hash.replace(/^SM3:/i, "");
      try {
        const result = await this.chainAdapter.submitAttestation({
          data_id: hash,
          data_hash: hexHash,
          metadata: {
            source: "medtrust-attestation",
            attestationLevel: this.attestationLevel,
            // algorithm-sandbox:执行隔离如实随存证留痕(attestationLevel 不变)。
            ...(extraMetadata ?? {}),
          },
          signer_address: "0x0000000000000000000000000000000000000000",
        });
        this.logger.log(
          `链上存证成功 hash=${hash.slice(0, 24)}… tx=${result.transaction_hash} block=${result.block_number}` +
            ` endorsements=${extraMetadata?.endorsements?.length ?? 0}`,
        );
        const anchoredAt = new Date().toISOString();
        await this.remember(
          hash,
          result.transaction_hash,
          result.block_number,
          ref,
          anchoredAt,
        );
        return {
          txHash: result.transaction_hash,
          block: result.block_number,
          hash,
          attestationLevel: this.attestationLevel,
          anchoredAt,
          ...(extraMetadata?.endorsements
            ? { endorsements: extraMetadata.endorsements }
            : {}),
        };
      } catch (err) {
        const existing = await this.resolveExisting(hash, hexHash, err);
        if (existing.outcome === "found") {
          // 同一对象重锚自己已上链的哈希（重复上报、补锚）是幂等操作，回带的就是它自己的记录；
          // 只有另一个对象算出相同哈希时才标 reused。归属不明时无从区分，一律按 reused 标。
          const ownRecord =
            (await this.ledger?.hasPointer(hash, ref).catch(() => false)) ??
            false;
          await this.remember(
            hash,
            existing.txHash,
            existing.block,
            ref,
            existing.anchoredAt,
          );
          this.logger.log(
            `哈希已在链上,返回既有存证记录(本次未产生新交易) hash=${hash.slice(0, 24)}…` +
              ` tx=${existing.txHash} block=${existing.block}`,
          );
          return {
            txHash: existing.txHash,
            block: existing.block,
            hash,
            attestationLevel: this.attestationLevel,
            ...(ownRecord ? {} : { reused: true }),
            ...(existing.anchoredAt ? { anchoredAt: existing.anchoredAt } : {}),
          };
        }
        degraded = existing.reason;
        this.logger.warn(
          `链上存证失败,降级为本地回执(${DEGRADE_LABEL[degraded]}): ${(err as Error).message}`,
        );
      }
    }
    // 链不可达降级:回执本地化,但背书**不丢**(已先持久化在派发记录,
    // 链恢复后可补锚;此处回带一份供界面显示)——on-chain-provider-endorsement D5。
    const block = ++this.localBlock;
    const txHash =
      LOCAL_RECEIPT_PREFIX +
      this.gm.sm3Hash(`tx:${hash}:${block}`).slice(0, 16);
    return {
      txHash,
      block,
      hash,
      attestationLevel: this.attestationLevel,
      degraded,
      ...(extraMetadata?.endorsements
        ? { endorsements: extraMetadata.endorsements }
        : {}),
    };
  }

  /**
   * 提交失败后判定：这是不是「哈希早已在链上」，是的话把既有记录找回来。
   *
   * 判据次序（不能换）：
   *  ① 只有**合约回滚**才可能是重复——链不可达时什么都不问，直接降级；
   *  ② 链侧给了结论就以链为准：sidecar 说「不是重复」或按哈希查链「不存在」，即使本地账本
   *     有这条哈希也不认（账本可能早于一次链重置）；
   *  ③ 交易号 / 区块优先取链侧解析的，其次取本地存证指针账本（账本只收真实上链成功的回执，
   *     合约又拒收重复哈希，所以「回滚 + 账本里有」足以认定它就是那条既有记录）；
   *  ④ 链侧**查不了**（旧版 sidecar 没有按哈希查询）时退到账本；账本也没有才降级。
   *     都找不回交易号则如实降级，不编造。
   */
  private async resolveExisting(
    hash: string,
    hexHash: string,
    err: unknown,
  ): Promise<
    | { outcome: "found"; txHash: string; block: number; anchoredAt?: string }
    | { outcome: "degrade"; reason: AttestationDegradeReason }
  > {
    if (!(err instanceof ChainTxRevertedError)) {
      return { outcome: "degrade", reason: "chain-unavailable" };
    }
    if (err.alreadyExists === false) {
      return { outcome: "degrade", reason: "chain-rejected" };
    }
    if (err.existing?.transaction_hash) {
      return {
        outcome: "found",
        txHash: err.existing.transaction_hash,
        block: err.existing.block_number,
        ...(err.existing.timestamp
          ? { anchoredAt: unixToIso(err.existing.timestamp) }
          : {}),
      };
    }

    // 链是否确认「该哈希已存在」：true = 确认；false = 查不了（只能凭账本）。
    let confirmedByChain = err.alreadyExists === true;
    let chainTimestamp: number | undefined;
    if (!confirmedByChain) {
      try {
        const onChain = await this.chainAdapter.findAttestation(hexHash);
        if (!onChain) return { outcome: "degrade", reason: "chain-rejected" };
        if (onChain.transaction_hash) {
          return {
            outcome: "found",
            txHash: onChain.transaction_hash,
            block: onChain.block_number ?? 0,
            ...(onChain.timestamp
              ? { anchoredAt: unixToIso(onChain.timestamp) }
              : {}),
          };
        }
        confirmedByChain = true;
        chainTimestamp = onChain.timestamp || undefined;
      } catch (lookupErr) {
        this.logger.warn(
          `交易回滚后按哈希查链不可用,改查本地存证指针账本: ${(lookupErr as Error).message}`,
        );
      }
    }

    const known = await this.ledger?.findByHash(hash).catch(() => null);
    if (known) {
      return {
        outcome: "found",
        txHash: known.txHash,
        block: Number(known.block),
        anchoredAt:
          known.anchoredAt ??
          (chainTimestamp ? unixToIso(chainTimestamp) : undefined),
      };
    }
    return {
      outcome: "degrade",
      reason: confirmedByChain ? "duplicate-unresolved" : "chain-rejected",
    };
  }

  /** 写存证指针。账本写失败不影响存证本身（链上记录已成立），只告警。 */
  private async remember(
    hash: string,
    txHash: string,
    block: number,
    subject: AttestationSubject,
    anchoredAt?: string,
  ): Promise<void> {
    if (!this.ledger) return;
    try {
      await this.ledger.record({
        ...subject,
        hash,
        txHash,
        block,
        anchoredAt,
        attestationLevel: this.attestationLevel,
      });
    } catch (err) {
      this.logger.warn(
        `存证指针入账本失败(链上记录不受影响): ${(err as Error).message}`,
      );
    }
  }

  /** P1-7:真实链上查验(供合约完整性校验三方比对)。 */
  async verify(hash: string): Promise<AttestationVerification> {
    if (!this.chainAdapter) return { valid: false, chain: null };
    const result = await this.chainAdapter.verifyAttestation(
      hash.replace(/^SM3:/i, ""),
    );
    return {
      valid: result.valid,
      chain: result.attestation
        ? {
            dataHash: result.attestation.data_hash,
            timestamp: result.attestation.timestamp,
            signer: result.attestation.signer,
          }
        : null,
    };
  }
}

const DEGRADE_LABEL: Record<AttestationDegradeReason, string> = {
  "no-chain-adapter": "未装配链适配器",
  "chain-unavailable": "链不可达",
  "chain-rejected": "链上合约拒收",
  "duplicate-unresolved": "链上已有同哈希记录,但未能找回其交易号",
};

function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
