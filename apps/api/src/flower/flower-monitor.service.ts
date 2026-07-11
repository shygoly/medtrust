import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { FlowerClientService } from "./flower-client.service";
import { FlowerConfigService } from "./flower-config.service";
import { FlowerServerHealth } from "./types";

interface ServerHealthEntry {
  serverName: string;
  health: FlowerServerHealth;
  lastChecked: Date;
  isHealthy: boolean;
}

/**
 * Flower Monitor Service
 * Monitors Flower server health and task status
 */
@Injectable()
export class FlowerMonitorService {
  private readonly logger = new Logger(FlowerMonitorService.name);
  private serverHealthStatus: Map<string, ServerHealthEntry> = new Map();
  private healthyServers: Set<string> = new Set();

  constructor(
    private flowerClient: FlowerClientService,
    private flowerConfig: FlowerConfigService,
  ) {}

  /**
   * Get health status for all servers
   */
  getAllServersHealth(): ServerHealthEntry[] {
    return Array.from(this.serverHealthStatus.values());
  }

  /**
   * Get health status for specific server
   */
  getServerHealth(serverName: string): ServerHealthEntry | undefined {
    return this.serverHealthStatus.get(serverName);
  }

  /**
   * Get list of healthy servers
   */
  getHealthyServers(): string[] {
    return Array.from(this.healthyServers);
  }

  /**
   * Check if server is healthy
   */
  isServerHealthy(serverName: string): boolean {
    return this.healthyServers.has(serverName);
  }

  /**
   * Get next available healthy server (round-robin)
   */
  getNextHealthyServer(): string | null {
    const healthy = this.getHealthyServers();
    if (healthy.length === 0) {
      return null;
    }
    // Simple round-robin: return first healthy server
    return healthy[0];
  }

  /**
   * Perform health check on all configured servers
   * Runs every 30 seconds
   */
  @Interval(30000)
  async performHealthChecks(): Promise<void> {
    this.logger.debug("Performing Flower server health checks");

    const servers = this.flowerConfig.getAllServerConfigs();

    for (const [serverName, config] of servers) {
      try {
        // Create temporary client for this server
        const health = await this.checkServerHealth(config.serverUrl);

        const entry: ServerHealthEntry = {
          serverName,
          health,
          lastChecked: new Date(),
          isHealthy: health.status === "healthy",
        };

        this.serverHealthStatus.set(serverName, entry);

        if (health.status === "healthy") {
          this.healthyServers.add(serverName);
          this.logger.debug(`Server ${serverName} is healthy`);
        } else {
          this.healthyServers.delete(serverName);
          this.logger.warn(
            `Server ${serverName} is unhealthy: ${health.status}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Health check failed for ${serverName}: ${error.message}`,
        );

        this.serverHealthStatus.set(serverName, {
          serverName,
          health: { status: "unreachable" },
          lastChecked: new Date(),
          isHealthy: false,
        });

        this.healthyServers.delete(serverName);
      }
    }
  }

  /**
   * Check health of specific server
   */
  private async checkServerHealth(
    serverUrl: string,
  ): Promise<FlowerServerHealth> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${serverUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { status: "unhealthy" };
      }

      const result = await response.json();
      return {
        status: "healthy",
        version: result.version,
        uptime: result.uptime,
        activeTasks: result.activeTasks,
        queuedTasks: result.queuedTasks,
        connectedClients: result.connectedClients,
      };
    } catch (error) {
      return { status: "unreachable" };
    }
  }

  /**
   * Get connection pool status
   */
  getConnectionPoolStatus() {
    return this.flowerClient.getConnectionPool();
  }
}
