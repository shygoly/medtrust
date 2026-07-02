import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sm3 } from 'sm-crypto';

export interface AttestationData {
  data_id: string;
  data_hash: string;
  metadata?: any;
  signer_address: string;
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
    this.sidecarUrl = this.configService.get<string>('CHAIN_SIDECAR_URL');
  }

  async submitAttestation(data: AttestationData): Promise<AttestationResult> {
    const url = `${this.sidecarUrl}/attest`;
    this.logger.log(`Submitting attestation for data: ${data.data_id} -> ${url}`);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataHash: data.data_hash,
        dataType: 'data_sharing',
        metadata: data.metadata != null ? JSON.stringify(data.metadata) : '{}',
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
    if (typeof body.status === 'number' && body.status !== 0) {
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

  async verifyAttestation(dataHash: string): Promise<VerificationResult> {
    try {
      this.logger.log(`Verifying attestation for hash: ${dataHash}`);

      // Mock implementation - actual implementation would query blockchain
      // const contract = new web3.eth.Contract(AttestationABI, contractAddress);
      // const result = await contract.methods.getAttestation(dataHash).call();

      // For now, return mock verification result
      return {
        valid: true,
        attestation: {
          data_hash: dataHash,
          timestamp: Date.now(),
          signer: '0xabcdef1234567890',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to verify attestation: ${error.message}`);
      return {
        valid: false,
        attestation: null,
      };
    }
  }

  async queryAttestationHistory(filters: {
    data_id?: string;
    signer?: string;
    from_block?: number;
    to_block?: number;
  }): Promise<any[]> {
    try {
      this.logger.log('Querying attestation history');

      // Mock implementation - actual implementation would query blockchain events
      // const contract = new web3.eth.Contract(AttestationABI, contractAddress);
      // const events = await contract.getPastEvents('AttestationCreated', {
      //   filter: filters,
      //   fromBlock: filters.from_block || 0,
      //   toBlock: filters.to_block || 'latest',
      // });

      return [];
    } catch (error) {
      this.logger.error(`Failed to query attestation history: ${error.message}`);
      throw new Error(`Failed to query attestation history: ${error.message}`);
    }
  }

  computeSM3Hash(data: string | Buffer): string {
    const input = typeof data === 'string' ? data : data.toString('hex');
    return sm3(input);
  }

  // Current block height via the chain sidecar (GET /block-number).
  async getBlockNumber(): Promise<number> {
    const resp = await fetch(`${this.sidecarUrl}/block-number`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await resp.json()) as { blockNumber?: string | number; error?: string };
    if (!resp.ok || body.error) {
      throw new Error(
        `getBlockNumber failed (HTTP ${resp.status}): ${body.error ?? resp.statusText}`,
      );
    }
    return Number(body.blockNumber);
  }
}
