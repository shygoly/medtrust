import { Injectable, Logger, Optional } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ChainAdapter } from "../../blockchain/adapters/chain.adapter";
import { DigitalContract } from "@medtrust/database";

export interface AttestationReceipt {
  txHash: string;
  block: number;
  hash: string; // the SM3 digest that was anchored
}

// 策略哈希上链存证(usage-control 4.3). The chain stores ONLY the hash (D6).
// Real anchoring goes through the ChainMaker sidecar via ChainAdapter; if the
// chain is unreachable this falls back to a local receipt so the orchestration
// is not blocked, but logs the degradation.
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);
  private localBlock = 1_840_000;

  constructor(
    private readonly gm: GMCryptoService,
    @Optional() private readonly chainAdapter?: ChainAdapter,
  ) {}

  attestContract(contract: DigitalContract): Promise<AttestationReceipt> {
    const hash =
      contract.hash ?? "SM3:" + this.gm.sm3Hash(JSON.stringify(contract));
    return this.anchor(hash);
  }

  /**
   * Anchor a precomputed digest on-chain. When a real ChainAdapter is wired
   * (production), this submits to the ChainMaker sidecar and returns the real
   * txHash + block. If the adapter is absent or the chain errors, it degrades
   * to a local deterministic receipt so the result is never lost — but the
   * caller can distinguish the two via the txHash prefix (0x… = local).
   */
  async anchor(hash: string): Promise<AttestationReceipt> {
    if (this.chainAdapter) {
      try {
        // The "SM3:" prefix is an internal convention; the chain sidecar
        // expects a bare hex digest. Strip the prefix so the Java SDK doesn't
        // choke parsing "SM3:…" as a hex string.
        const hexHash = hash.replace(/^SM3:/i, "");
        const result = await this.chainAdapter.submitAttestation({
          data_id: hash,
          data_hash: hexHash,
          metadata: { source: "medtrust-attestation" },
          signer_address: "0x0000000000000000000000000000000000000000",
        });
        this.logger.log(
          `链上存证成功 hash=${hash.slice(0, 24)}… tx=${result.transaction_hash} block=${result.block_number}`,
        );
        return {
          txHash: result.transaction_hash,
          block: result.block_number,
          hash,
        };
      } catch (err) {
        this.logger.warn(
          `链上存证失败,降级为本地回执: ${(err as Error).message}`,
        );
      }
    }
    const block = ++this.localBlock;
    const txHash =
      "0xLOCAL:" + this.gm.sm3Hash(`tx:${hash}:${block}`).slice(0, 16);
    return { txHash, block, hash };
  }
}
