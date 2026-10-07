import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sm3 } from "sm-crypto";

export interface AttestationData {
  data_id: string;
  data_hash: string;
  metadata?: any;
  signer_address?: string; // 由链侧 tx 的 msg.sender 决定,不再由控制面硬编码
}

export interface AttestationResult {
  transaction_hash: string;
  block_number: number;
  contract_address: string;
}

export interface VerificationResult {
  valid: boolean;
  attestation: {
    data_hash: string;
    timestamp: number;
    signer: string;
  } | null;
}

/** 链上已有的一条存证记录。交易号 / 区块只有 sidecar 能解析时才有（旧 sidecar 不回带）。 */
export interface OnChainAttestation {
  data_hash: string;
  timestamp: number;
  signer: string;
  transaction_hash?: string;
  block_number?: number;
}

export interface ExistingAttestationPointer {
  transaction_hash: string;
  block_number: number;
  timestamp?: number;
}

/**
 * 交易已送达链、但合约执行回滚（如 `Attestation already exists`）。
 *
 * 与「链不可达」是两回事，必须可区分：回滚时链是通的，调用方应当去查这条哈希是不是
 * 早已在链上，而不是把它当成断链去降级。`alreadyExists` / `existing` 由新版 sidecar
 * 回带；旧版不回带（undefined），由调用方用 `findAttestation` 自行判定。
 */
export class ChainTxRevertedError extends Error {
  readonly alreadyExists?: boolean;
  readonly existing?: ExistingAttestationPointer;

  constructor(
    readonly status: number,
    detail: {
      reason?: string;
      alreadyExists?: boolean;
      existing?: ExistingAttestationPointer;
    } = {},
  ) {
    super(
      `On-chain tx reverted, status=${status}` +
        (detail.reason ? ` (${detail.reason})` : ""),
    );
    this.name = "ChainTxRevertedError";
    this.alreadyExists = detail.alreadyExists;
    this.existing = detail.existing;
  }
}

@Injectable()
export class ChainAdapter {
  private readonly logger = new Logger(ChainAdapter.name);
  private readonly sidecarUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.sidecarUrl = this.configService.get<string>("CHAIN_SIDECAR_URL");
  }

  async submitAttestation(data: AttestationData): Promise<AttestationResult> {
    const url = `${this.sidecarUrl}/attest`;
    this.logger.log(
      `Submitting attestation for data: ${data.data_id} -> ${url}`,
    );

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataHash: data.data_hash,
        dataType: "data_sharing",
        metadata: data.metadata != null ? JSON.stringify(data.metadata) : "{}",
      }),
      signal: AbortSignal.timeout(15000),
    });

    const body = (await resp.json()) as {
      txHash?: string;
      blockNumber?: string;
      status?: number;
      contract?: string;
      error?: string;
      message?: string;
      alreadyExists?: boolean;
      existing?: {
        txHash?: string;
        blockNumber?: string | number;
        timestamp?: string | number;
      } | null;
    };

    if (!resp.ok || body.error) {
      throw new Error(
        `Attestation failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
      );
    }
    // On-chain receipt status: 0 = success.
    if (typeof body.status === "number" && body.status !== 0) {
      throw new ChainTxRevertedError(body.status, {
        reason: body.message || undefined,
        alreadyExists:
          typeof body.alreadyExists === "boolean"
            ? body.alreadyExists
            : undefined,
        existing: body.existing?.txHash
          ? {
              transaction_hash: body.existing.txHash,
              block_number: Number(body.existing.blockNumber ?? 0),
              ...(body.existing.timestamp != null
                ? { timestamp: Number(body.existing.timestamp) }
                : {}),
            }
          : undefined,
      });
    }

    this.logger.log(
      `Attestation on-chain: tx=${body.txHash} block=${body.blockNumber}`,
    );
    return {
      transaction_hash: body.txHash,
      block_number: Number(body.blockNumber),
      contract_address: body.contract,
    };
  }

  /**
   * 按哈希读链上存证记录（sidecar 读合约 getAttestationByHash）。
   *
   * 未上链返回 null；**问不到链就抛错**——「不存在」与「不知道」不能混为一谈，
   * 否则重复哈希的判定会把断链误读成「没上过链」。交易号 / 区块仅在 sidecar 能解析时回带。
   */
  async findAttestation(dataHash: string): Promise<OnChainAttestation | null> {
    const url = `${this.sidecarUrl}/attestation/${encodeURIComponent(dataHash)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = (await resp.json()) as {
      exists?: boolean;
      timestamp?: string | number;
      attester?: string;
      dataHash?: string;
      txHash?: string | null;
      blockNumber?: string | number | null;
      error?: string;
    };

    if (!resp.ok || body.error) {
      throw new Error(
        `findAttestation failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
      );
    }
    if (!body.exists) return null;

    return {
      data_hash: body.dataHash ?? dataHash,
      timestamp: Number(body.timestamp ?? 0),
      signer: body.attester ?? "",
      ...(body.txHash
        ? {
            transaction_hash: body.txHash,
            block_number: Number(body.blockNumber ?? 0),
          }
        : {}),
    };
  }

  // 真实链上查验:已锚定哈希 → valid:true + 真实 timestamp/attester;未锚定/篡改 → valid:false。
  async verifyAttestation(dataHash: string): Promise<VerificationResult> {
    try {
      this.logger.log(`Verifying attestation for hash: ${dataHash}`);
      const found = await this.findAttestation(dataHash);
      if (!found) return { valid: false, attestation: null };
      return {
        valid: true,
        attestation: {
          data_hash: found.data_hash,
          timestamp: found.timestamp,
          signer: found.signer,
        },
      };
    } catch (error) {
      // fail-closed:链不可达或查询异常时不声称 valid
      this.logger.error(`Failed to verify attestation: ${error.message}`);
      return { valid: false, attestation: null };
    }
  }

  async queryAttestationHistory(filters: {
    data_id?: string;
    signer?: string;
    from_block?: number;
    to_block?: number;
  }): Promise<any[]> {
    try {
      this.logger.log("Querying attestation history");
      const url = `${this.sidecarUrl}/attestations`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const body = (await resp.json()) as {
        attestations?: Array<{
          dataHash?: string;
          attester?: string;
          timestamp?: string | number;
          blockNumber?: string | number;
        }>;
        error?: string;
      };
      if (!resp.ok || body.error) {
        throw new Error(
          `queryAttestationHistory failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
        );
      }
      const list = body.attestations ?? [];
      return list.filter((a) => {
        if (filters.signer && a.attester && a.attester !== filters.signer)
          return false;
        const block = Number(a.blockNumber ?? 0);
        if (filters.from_block != null && block < filters.from_block)
          return false;
        if (filters.to_block != null && block > filters.to_block) return false;
        return true;
      });
    } catch (error) {
      this.logger.error(
        `Failed to query attestation history: ${error.message}`,
      );
      throw new Error(`Failed to query attestation history: ${error.message}`);
    }
  }

  computeSM3Hash(data: string | Buffer): string {
    const input = typeof data === "string" ? data : data.toString("hex");
    return sm3(input);
  }

  // Current block height via the chain sidecar (GET /block-number).
  async getBlockNumber(): Promise<number> {
    const resp = await fetch(`${this.sidecarUrl}/block-number`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await resp.json()) as {
      blockNumber?: string | number;
      error?: string;
    };
    if (!resp.ok || body.error) {
      throw new Error(
        `getBlockNumber failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
      );
    }
    return Number(body.blockNumber);
  }
}
