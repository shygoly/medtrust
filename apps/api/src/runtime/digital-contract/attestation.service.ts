import { Injectable } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { DigitalContract } from "@medtrust/database";

export interface AttestationReceipt {
  txHash: string;
  block: number;
  hash: string; // the SM3 digest that was anchored
}

// 策略哈希上链存证(usage-control 4.3). The chain stores ONLY the hash (D6).
// Real anchoring goes through the FISCO BCOS adapter in src/blockchain
// (currently a mock); this service computes the digest and produces a receipt.
@Injectable()
export class AttestationService {
  private block = 1_840_000;

  constructor(private readonly gm: GMCryptoService) {}

  attestContract(contract: DigitalContract): AttestationReceipt {
    const hash =
      contract.hash ?? "SM3:" + this.gm.sm3Hash(JSON.stringify(contract));
    return this.anchor(hash);
  }

  // Generic anchor of a precomputed digest (also used by task/output attestation).
  anchor(hash: string): AttestationReceipt {
    const block = ++this.block;
    const txHash = "0x" + this.gm.sm3Hash(`tx:${hash}:${block}`).slice(0, 16);
    return { txHash, block, hash };
  }
}
