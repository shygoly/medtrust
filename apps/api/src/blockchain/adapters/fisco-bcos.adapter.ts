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
export class FiscoBcosAdapter {
  private readonly logger = new Logger(FiscoBcosAdapter.name);
  private readonly nodes: string[];
  private currentNodeIndex = 0;

  constructor(private readonly configService: ConfigService) {
    this.nodes = [
      this.configService.get<string>('FISCO_BCOS_NODE1_URL'),
      this.configService.get<string>('FISCO_BCOS_NODE2_URL'),
      this.configService.get<string>('FISCO_BCOS_NODE3_URL'),
    ].filter(Boolean);
  }

  async submitAttestation(data: AttestationData): Promise<AttestationResult> {
    try {
      this.logger.log(`Submitting attestation for data: ${data.data_id}`);

      // Mock implementation - actual implementation would use fisco-bcos-browser-sdk
      // const Web3 = require('fisco-bcos-browser-sdk').Web3;
      // const web3 = new Web3(this.getCurrentNode());
      // const contract = new web3.eth.Contract(AttestationABI, contractAddress);
      // const tx = await contract.methods.attest(data.data_hash, JSON.stringify(data.metadata)).send({
      //   from: data.signer_address,
      // });

      const transactionHash = `0x${Buffer.from(`tx-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
      const blockNumber = Math.floor(Date.now() / 1000);
      const contractAddress = this.configService.get<string>('FISCO_BCOS_CONTRACT_ADDRESS', '0x1234567890abcdef');

      this.logger.log(`Attestation submitted: ${transactionHash}`);

      return {
        transaction_hash: transactionHash,
        block_number: blockNumber,
        contract_address: contractAddress,
      };
    } catch (error) {
      this.logger.error(`Failed to submit attestation: ${error.message}`);
      // Try failover to next node
      if (this.nodes.length > 1) {
        this.switchToNextNode();
        return this.submitAttestation(data);
      }
      throw new Error(`Failed to submit attestation: ${error.message}`);
    }
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

  async getBlockNumber(): Promise<number> {
    try {
      // Mock implementation
      return Math.floor(Date.now() / 1000);
    } catch (error) {
      this.logger.error(`Failed to get block number: ${error.message}`);
      throw error;
    }
  }

  private getCurrentNode(): string {
    return this.nodes[this.currentNodeIndex];
  }

  private switchToNextNode(): void {
    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
    this.logger.log(`Switched to FISCO BCOS node: ${this.getCurrentNode()}`);
  }
}
