import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom, timeout, catchError, of } from "rxjs";

export interface ServiceHealth {
  service: string;
  status: "healthy" | "unhealthy" | "unknown";
  responseTime?: number;
  error?: string;
  timestamp: string;
}

export interface OverallHealth {
  status: "healthy" | "degraded" | "unhealthy";
  services: ServiceHealth[];
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async checkAllServices(): Promise<OverallHealth> {
    const services = await Promise.all([
      this.checkFateFlow(),
      this.checkChain(),
      this.checkMpSpdz(),
      this.checkFhir(),
    ]);

    const healthyCount = services.filter((s) => s.status === "healthy").length;
    const unhealthyCount = services.filter(
      (s) => s.status === "unhealthy",
    ).length;

    let overallStatus: "healthy" | "degraded" | "unhealthy";
    if (unhealthyCount === 0) {
      overallStatus = "healthy";
    } else if (healthyCount > 0) {
      overallStatus = "degraded";
    } else {
      overallStatus = "unhealthy";
    }

    return {
      status: overallStatus,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  async checkFateFlow(): Promise<ServiceHealth> {
    const fateFlowUrl = this.configService.get<string>("FATE_FLOW_URL");
    const featureEnabled = this.configService.get<boolean>(
      "FEATURE_FEDERATED_LEARNING",
      true,
    );

    if (!featureEnabled) {
      return {
        service: "fate-flow",
        status: "unknown",
        error: "Feature disabled",
        timestamp: new Date().toISOString(),
      };
    }

    if (!fateFlowUrl) {
      return this.unconfigured("fate-flow");
    }

    return this.checkHttpService(
      "fate-flow",
      `${fateFlowUrl}/v1/version`,
      5000,
    );
  }

  async checkChain(): Promise<ServiceHealth> {
    const sidecarUrl = this.configService.get<string>("CHAIN_SIDECAR_URL");
    const featureEnabled = this.configService.get<boolean>(
      "FEATURE_BLOCKCHAIN",
      true,
    );

    if (!featureEnabled) {
      return {
        service: "blockchain",
        status: "unknown",
        error: "Feature disabled",
        timestamp: new Date().toISOString(),
      };
    }

    if (!sidecarUrl) {
      return this.unconfigured("blockchain");
    }

    return this.checkHttpService(
      "blockchain",
      `${sidecarUrl}/block-number`,
      5000,
    );
  }

  async checkMpSpdz(): Promise<ServiceHealth> {
    const mpSpdzUrl = this.configService.get<string>("MP_SPDZ_GATEWAY_URL");
    const featureEnabled = this.configService.get<boolean>("FEATURE_MPC", true);

    if (!featureEnabled) {
      return {
        service: "mp-spdz",
        status: "unknown",
        error: "Feature disabled",
        timestamp: new Date().toISOString(),
      };
    }

    if (!mpSpdzUrl) {
      return this.unconfigured("mp-spdz");
    }

    return this.checkHttpService("mp-spdz", `${mpSpdzUrl}/health`, 5000);
  }

  async checkFhir(): Promise<ServiceHealth> {
    const fhirUrl = this.configService.get<string>("FHIR_SERVER_URL");
    const featureEnabled = this.configService.get<boolean>(
      "FEATURE_FHIR",
      true,
    );

    if (!featureEnabled) {
      return {
        service: "fhir",
        status: "unknown",
        error: "Feature disabled",
        timestamp: new Date().toISOString(),
      };
    }

    if (!fhirUrl) {
      return this.unconfigured("fhir");
    }

    return this.checkHttpService("fhir", `${fhirUrl}/metadata`, 5000);
  }

  private unconfigured(serviceName: string): ServiceHealth {
    return {
      service: serviceName,
      status: "unknown",
      error: "URL not configured",
      timestamp: new Date().toISOString(),
    };
  }

  private async checkHttpService(
    serviceName: string,
    url: string,
    timeoutMs: number,
  ): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.get(url).pipe(
          timeout(timeoutMs),
          catchError((error) => {
            this.logger.warn(
              `Health check failed for ${serviceName}: ${error.message}`,
            );
            return of({ error });
          }),
        ),
      );

      const responseTime = Date.now() - startTime;

      if ("error" in response) {
        return {
          service: serviceName,
          status: "unhealthy",
          responseTime,
          error: response.error.message,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        service: serviceName,
        status: "healthy",
        responseTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        service: serviceName,
        status: "unhealthy",
        responseTime,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
