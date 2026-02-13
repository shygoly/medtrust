import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FlowerMonitorService } from './flower-monitor.service';
import { FlowerClientService } from './flower-client.service';
import { FlowerConfigService } from './flower-config.service';
import { FlowerErrorHandler } from './flower-error.handler';

/**
 * Flower Health Controller
 * Provides health check endpoints for Flower integration
 */
@ApiTags('flower-health')
@Controller('api/v1/flower/health')
export class FlowerHealthController {
  private readonly logger = new Logger(FlowerHealthController.name);

  constructor(
    private readonly flowerMonitorService: FlowerMonitorService,
    private readonly flowerClient: FlowerClientService,
    private readonly flowerConfig: FlowerConfigService,
    private readonly errorHandler: FlowerErrorHandler,
  ) {}

  /**
   * Get overall health status
   * GET /api/v1/flower/health
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取 Flower 健康状态',
    description: '获取 Flower 服务器和连接池的整体健康状态',
  })
  @ApiResponse({
    status: 200,
    description: '健康检查成功',
  })
  async getHealth(): Promise<{
    status: string;
    servers: any[];
    connectionPool: any;
    healthyServers: string[];
  }> {
    this.logger.debug('Getting Flower health status');

    try {
      const serverHealth = this.flowerMonitorService.getAllServersHealth();
      const connectionPool = this.flowerClient.getConnectionPool();
      const healthyServers = this.flowerMonitorService.getHealthyServers();

      const overallStatus = healthyServers.length > 0 ? 'healthy' : 'unhealthy';

      return {
        status: overallStatus,
        servers: serverHealth,
        connectionPool,
        healthyServers,
      };
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'getHealth');
    }
  }

  /**
   * Get detailed server health
   * GET /api/v1/flower/health/servers
   */
  @Get('servers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取所有服务器健康状态',
    description: '获取所有配置的 Flower 服务器的详细健康信息',
  })
  async getServersHealth(): Promise<any[]> {
    this.logger.debug('Getting servers health');

    try {
      return this.flowerMonitorService.getAllServersHealth();
    } catch (error) {
      throw this.errorHandler.handleClientError(error, 'getServersHealth');
    }
  }

  /**
   * Get connection pool status
   * GET /api/v1/flower/health/connections
   */
  @Get('connections')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取连接池状态',
    description: '获取 HTTP 连接池的使用情况',
  })
  async getConnectionPoolStatus(): Promise<any> {
    this.logger.debug('Getting connection pool status');

    return this.flowerClient.getConnectionPool();
  }

  /**
   * Get configuration (masked)
   * GET /api/v1/flower/health/config
   */
  @Get('config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取 Flower 配置',
    description: '获取 Flower 配置信息（敏感信息已脱敏）',
  })
  async getConfig(): Promise<any> {
    this.logger.debug('Getting Flower config');

    const config = this.flowerConfig.getConfig();

    return {
      serverUrl: config.serverUrl,
      requestTimeout: config.requestTimeout,
      maxRetries: config.maxRetries,
      maxConnections: config.maxConnections,
      healthCheckInterval: config.healthCheckInterval,
      hasApiKey: !!config.apiKey,
      hasWebhookSecret: !!config.webhookSecret,
    };
  }
}
