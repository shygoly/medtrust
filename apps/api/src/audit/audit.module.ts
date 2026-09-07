import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditService } from "./audit.service";
import { EvidencePackageService } from "./evidence-package.service";
import { AuditController } from "./audit.controller";
import {
  AttestationRef,
  AuditLog,
  DigitalContractEntity,
  Tenant,
} from "@medtrust/database";

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, Tenant]),
    TypeOrmModule.forFeature(
      [AttestationRef, DigitalContractEntity],
      "controlplane",
    ),
  ],
  controllers: [AuditController],
  providers: [AuditService, EvidencePackageService],
  exports: [AuditService],
})
export class AuditModule {}
