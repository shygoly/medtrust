import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Check overall system health" })
  @ApiResponse({ status: 200, description: "System health status" })
  async checkHealth() {
    return this.healthService.checkAllServices();
  }

  @Get("fate-flow")
  @ApiOperation({ summary: "Check FATE Flow service health" })
  @ApiResponse({ status: 200, description: "FATE Flow health status" })
  async checkFateFlow() {
    return this.healthService.checkFateFlow();
  }

  @Get("blockchain")
  @ApiOperation({ summary: "Check blockchain health" })
  @ApiResponse({ status: 200, description: "Blockchain health status" })
  async checkChain() {
    return this.healthService.checkChain();
  }

  @Get("mp-spdz")
  @ApiOperation({ summary: "Check MP-SPDZ gateway health" })
  @ApiResponse({ status: 200, description: "MP-SPDZ health status" })
  async checkMpSpdz() {
    return this.healthService.checkMpSpdz();
  }

  @Get("fhir")
  @ApiOperation({ summary: "Check FHIR server health" })
  @ApiResponse({ status: 200, description: "FHIR server health status" })
  async checkFhir() {
    return this.healthService.checkFhir();
  }
}
