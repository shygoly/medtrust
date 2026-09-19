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
import { PreReviewGate } from "./pre-review-gate";
import { CapabilityModule } from "../capability.module";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

// L2 合规域(P1): 组合持久化 + ComplianceEngine 裁决 + 预审裁决快照。
// 依赖能力注册表(校验对象已落地)与国密(规则摘要 SM3)。
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
    CapabilityModule,
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService, GMCryptoService, PreReviewGate],
  exports: [ComplianceService, PreReviewGate],
})
export class ComplianceModule {}
