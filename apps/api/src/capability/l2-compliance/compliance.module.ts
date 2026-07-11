import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Composition,
  ComplianceEvaluation,
  L1Scenario,
  L6Protocol,
  L2RiskPolicy,
  L2Guardrail,
  L2BlockRule,
} from "@medtrust/database";
import { ComplianceService } from "./compliance.service";
import { ComplianceController } from "./compliance.controller";

// L2 合规域(P1): 组合持久化 + ComplianceEngine 裁决。
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Composition,
      ComplianceEvaluation,
      L1Scenario,
      L6Protocol,
      L2RiskPolicy,
      L2Guardrail,
      L2BlockRule,
    ]),
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
