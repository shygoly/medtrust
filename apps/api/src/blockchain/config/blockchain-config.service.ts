import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface BlockchainConfig {
  nodeUrls: string[];
  devNodeUrl: string;
  chainId: number;
  groupId: number;
  contractAddress: string;
  vaultAttestationKeyPath: string;
  environment: "development" | "production";
}

@Injectable()
export class BlockchainConfigService {
  private readonly config: BlockchainConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  private loadConfig(): BlockchainConfig {
    const nodeEnv = this.configService.get<string>("NODE_ENV", "development");
    const isDevelopment = nodeEnv === "development";

    return {
      nodeUrls: isDevelopment
        ? [
            this.configService.get<string>(
              "CHAIN_DEV_SIDECAR_URL",
              "http://localhost:8545",
            ),
          ]
        : [
            this.configService.get<string>("CHAIN_SIDECAR_URL"),
            this.configService.get<string>("CHAIN_SIDECAR_NODE2_URL"),
            this.configService.get<string>("CHAIN_SIDECAR_NODE3_URL"),
          ].filter(Boolean),
      devNodeUrl: this.configService.get<string>(
        "CHAIN_DEV_SIDECAR_URL",
        "http://localhost:8545",
      ),
      chainId: this.configService.get<number>("CHAIN_ID", 1),
      groupId: this.configService.get<number>("CHAIN_GROUP_ID", 1),
      contractAddress: this.configService.get<string>(
        "CHAIN_CONTRACT_ADDRESS",
        "0x0000000000000000000000000000000000000000",
      ),
      vaultAttestationKeyPath: this.configService.get<string>(
        "VAULT_ATTESTATION_KEY_PATH",
        "secret/data/blockchain/attestation-key",
      ),
      environment: isDevelopment ? "development" : "production",
    };
  }

  private validateConfig(): void {
    if (!this.config.nodeUrls || this.config.nodeUrls.length === 0) {
      throw new Error("No blockchain node URLs configured");
    }

    if (!this.config.chainId) {
      throw new Error("CHAIN_ID is required");
    }

    if (!this.config.groupId) {
      throw new Error("CHAIN_GROUP_ID is required");
    }

    if (!this.config.vaultAttestationKeyPath) {
      throw new Error("VAULT_ATTESTATION_KEY_PATH is required");
    }
  }

  getConfig(): BlockchainConfig {
    return { ...this.config };
  }

  getNodeUrls(): string[] {
    return [...this.config.nodeUrls];
  }

  getChainId(): number {
    return this.config.chainId;
  }

  getGroupId(): number {
    return this.config.groupId;
  }

  getContractAddress(): string {
    return this.config.contractAddress;
  }

  getVaultKeyPath(): string {
    return this.config.vaultAttestationKeyPath;
  }

  isDevelopment(): boolean {
    return this.config.environment === "development";
  }

  isProduction(): boolean {
    return this.config.environment === "production";
  }
}
