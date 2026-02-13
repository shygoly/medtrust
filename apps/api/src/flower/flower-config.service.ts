import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlowerConfig, FLAlgorithmType } from './types';

/**
 * Flower Configuration Service
 * Manages Flower server configuration and multi-server routing
 */
@Injectable()
export class FlowerConfigService {
  private readonly logger = new Logger(FlowerConfigService.name);
  private config: FlowerConfig;
  private serverConfigs: Map<string, FlowerConfig> = new Map();

  constructor(private configService: ConfigService) {
    this.loadConfig();
    this.loadMultiServerConfig();
  }

  /**
   * Load main Flower configuration
   */
  private loadConfig(): void {
    this.config = {
      serverUrl: this.configService.get<string>('FLOWER_SERVER_URL', 'http://localhost:8080'),
      apiKey: this.configService.get<string>('FLOWER_API_KEY'),
      requestTimeout: this.configService.get<number>('FLOWER_REQUEST_TIMEOUT', 30000),
      maxRetries: this.configService.get<number>('FLOWER_MAX_RETRIES', 3),
      maxConnections: this.configService.get<number>('FLOWER_MAX_CONNECTIONS', 10),
      webhookSecret: this.configService.get<string>('FLOWER_WEBHOOK_SECRET', 'default-secret'),
      healthCheckInterval: this.configService.get<number>('FLOWER_HEALTH_CHECK_INTERVAL', 30000),
    };

    this.logger.log(`Flower config loaded: ${this.config.serverUrl}`);
  }

  /**
   * Load multi-server configuration from environment
   * Format: FLOWER_SERVER_<NAME>_URL
   */
  private loadMultiServerConfig(): void {
    const envKeys = Object.keys(process.env);
    const serverKeys = envKeys.filter((key) => key.match(/^FLOWER_SERVER_.*_URL$/));

    for (const key of serverKeys) {
      const serverName = key.replace('FLOWER_SERVER_', '').replace('_URL', '').toLowerCase();
      const serverUrl = process.env[key];

      if (serverUrl) {
        const serverConfig: FlowerConfig = {
          serverUrl,
          apiKey: process.env[`FLOWER_SERVER_${serverName.toUpperCase()}_API_KEY`] || this.config.apiKey,
          requestTimeout: parseInt(process.env[`FLOWER_SERVER_${serverName.toUpperCase()}_TIMEOUT`] || '30000'),
          maxRetries: this.config.maxRetries,
          maxConnections: this.config.maxConnections,
          webhookSecret: this.config.webhookSecret,
          healthCheckInterval: this.config.healthCheckInterval,
        };

        this.serverConfigs.set(serverName, serverConfig);
        this.logger.log(`Registered Flower server: ${serverName} -> ${serverUrl}`);
      }
    }

    // Always register default server
    if (!this.serverConfigs.has('default')) {
      this.serverConfigs.set('default', this.config);
    }
  }

  /**
   * Get default configuration
   */
  getConfig(): FlowerConfig {
    return this.config;
  }

  /**
   * Get configuration for specific server
   */
  getServerConfig(serverName: string): FlowerConfig | undefined {
    return this.serverConfigs.get(serverName);
  }

  /**
   * Get all server configurations
   */
  getAllServerConfigs(): Map<string, FlowerConfig> {
    return this.serverConfigs;
  }

  /**
   * Route task to appropriate server based on algorithm type
   */
  getServerForAlgorithm(algorithmType: FLAlgorithmType): string {
    // Route specific algorithms to specialized servers if configured
    switch (algorithmType) {
      case FLAlgorithmType.FEDPROX:
        return this.serverConfigs.has('fedprox') ? 'fedprox' : 'default';
      case FLAlgorithmType.FEDNOVA:
        return this.serverConfigs.has('fednova') ? 'fednova' : 'default';
      default:
        return 'default';
    }
  }

  /**
   * Get webhook secret for signature validation
   */
  getWebhookSecret(): string {
    return this.config.webhookSecret;
  }

  /**
   * Get health check interval
   */
  getHealthCheckInterval(): number {
    return this.config.healthCheckInterval;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<FlowerConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.log('Flower configuration updated');
  }
}
