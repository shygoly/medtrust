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
    };

    if (!resp.ok || body.error) {
      throw new Error(
        `Attestation failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
      );
    }
    // On-chain receipt status: 0 = success.
    if (typeof body.status === "number" && body.status !== 0) {
      throw new Error(`On-chain tx reverted, status=${body.status}`);
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

  // 真实链上查验:sidecar 读合约 getAttestationByHash,返回链上字段。
  // 已锚定哈希 → valid:true + 真实 timestamp/attester;未锚定/篡改 → valid:false。
  async verifyAttestation(dataHash: string): Promise<VerificationResult> {
    try {
      const url = `${this.sidecarUrl}/attestation/${encodeURIComponent(dataHash)}`;
      this.logger.log(`Verifying attestation for hash: ${dataHash}`);

      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const body = (await resp.json()) as {
        exists?: boolean;
        timestamp?: string | number;
        attester?: string;
        dataHash?: string;
        error?: string;
      };

      if (!resp.ok || body.error) {
        throw new Error(
          `verifyAttestation failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
        );
      }

      if (!body.exists) {
        return { valid: false, attestation: null };
      }

      return {
        valid: true,
        attestation: {
          data_hash: body.dataHash ?? dataHash,
          timestamp: Number(body.timestamp ?? 0),
          signer: body.attester ?? "",
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
