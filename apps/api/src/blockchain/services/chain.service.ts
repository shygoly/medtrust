import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Web3 from 'web3';
import { BlockchainConfigService } from '../config/blockchain-config.service';

export interface ConnectionStatus {
  connected: boolean;
  nodeUrl: string;
  blockNumber: number;
  lastChecked: Date;
}

@Injectable()
export class ChainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChainService.name);
  private web3: Web3;
  private currentNodeUrl: string;
  private currentNodeIndex = 0;
  private connectionStatus: ConnectionStatus;
  private healthCheckInterval: NodeJS.Timeout;
  private reconnecting = false;

  constructor(private readonly configService: BlockchainConfigService) {}

  async onModuleInit() {
    await this.initialize();
    this.startHealthCheck();
  }

  async onModuleDestroy() {
    this.stopHealthCheck();
    if (this.web3 && this.web3.currentProvider) {
      // Clean up connection
      this.logger.log('Disconnecting from blockchain node');
    }
  }

  private async initialize(): Promise<void> {
    const nodeUrls = this.configService.getNodeUrls();

    this.logger.log(`Initializing blockchain SDK with ${nodeUrls.length} node(s)`);

    for (let i = 0; i < nodeUrls.length; i++) {
      try {
        await this.connectToNode(nodeUrls[i]);
        this.currentNodeIndex = i;
        this.logger.log(`Successfully connected to blockchain node: ${this.currentNodeUrl}`);
        return;
      } catch (error) {
        this.logger.warn(`Failed to connect to node ${nodeUrls[i]}: ${error.message}`);
      }
    }

    // If all nodes failed, log error but don't throw - allow graceful degradation
    this.logger.error('Failed to connect to any blockchain nodes');
    this.connectionStatus = {
      connected: false,
      nodeUrl: null,
      blockNumber: 0,
      lastChecked: new Date(),
    };
  }

  private async connectToNode(nodeUrl: string): Promise<void> {
    this.logger.log(`Attempting to connect to: ${nodeUrl}`);

    this.web3 = new Web3(nodeUrl);
    this.currentNodeUrl = nodeUrl;

    // Test connection by getting block number
    const blockNumber = await this.web3.eth.getBlockNumber();

    this.connectionStatus = {
      connected: true,
      nodeUrl: nodeUrl,
      blockNumber: blockNumber,
      lastChecked: new Date(),
    };

    this.logger.log(`Connected to node at block ${blockNumber}`);
  }

  private startHealthCheck(): void {
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        this.logger.error(`Health check failed: ${error.message}`);
      });
    }, 30000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.web3 || !this.connectionStatus.connected) {
      // Try to reconnect
      if (!this.reconnecting) {
        await this.reconnect();
      }
      return;
    }

    try {
      const blockNumber = await this.web3.eth.getBlockNumber();

      // Check if node is lagging (block number hasn't increased in 60 seconds)
      const timeSinceLastCheck = Date.now() - this.connectionStatus.lastChecked.getTime();
      if (blockNumber === this.connectionStatus.blockNumber && timeSinceLastCheck > 60000) {
        this.logger.warn(`Node appears to be lagging (block ${blockNumber} for ${timeSinceLastCheck}ms)`);
        await this.switchToNextNode();
        return;
      }

      this.connectionStatus = {
        connected: true,
        nodeUrl: this.currentNodeUrl,
        blockNumber: blockNumber,
        lastChecked: new Date(),
      };
    } catch (error) {
      this.logger.error(`Health check failed for ${this.currentNodeUrl}: ${error.message}`);
      this.connectionStatus.connected = false;
      await this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.logger.log('Attempting to reconnect to blockchain...');

    try {
      await this.switchToNextNode();
    } finally {
      this.reconnecting = false;
    }
  }

  private async switchToNextNode(): Promise<void> {
    const nodeUrls = this.configService.getNodeUrls();

    if (nodeUrls.length === 1) {
      // Only one node, try reconnecting to it
      try {
        await this.connectToNode(nodeUrls[0]);
      } catch (error) {
        this.logger.error(`Failed to reconnect to node: ${error.message}`);
        this.connectionStatus.connected = false;
      }
      return;
    }

    // Try next node in rotation
    for (let i = 0; i < nodeUrls.length; i++) {
      this.currentNodeIndex = (this.currentNodeIndex + 1) % nodeUrls.length;
      const nodeUrl = nodeUrls[this.currentNodeIndex];

      try {
        await this.connectToNode(nodeUrl);
        this.logger.log(`Switched to node: ${nodeUrl}`);
        return;
      } catch (error) {
        this.logger.warn(`Failed to connect to node ${nodeUrl}: ${error.message}`);
      }
    }

    this.logger.error('Failed to connect to any available nodes');
    this.connectionStatus.connected = false;
  }

  getWeb3(): Web3 {
    if (!this.web3) {
      throw new Error('blockchain SDK not initialized');
    }
    return this.web3;
  }

  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  isConnected(): boolean {
    return this.connectionStatus?.connected || false;
  }

  getCurrentNodeUrl(): string {
    return this.currentNodeUrl;
  }

  async getBlockNumber(): Promise<number> {
    if (!this.isConnected()) {
      throw new Error('Not connected to blockchain node');
    }
    return await this.web3.eth.getBlockNumber();
  }

  async getChainId(): Promise<number> {
    if (!this.isConnected()) {
      throw new Error('Not connected to blockchain node');
    }
    return await this.web3.eth.getChainId();
  }
}
