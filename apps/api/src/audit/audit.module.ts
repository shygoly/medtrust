import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";
import { AuditLog, Tenant } from "@medtrust/database";

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Tenant])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
