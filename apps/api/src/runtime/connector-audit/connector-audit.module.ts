import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConnectorAuditDigest } from "@medtrust/database";
import { ConnectorAuditService } from "./connector-audit.service";

// 连接器审计摘要接收与查验(TC609 P0-6)。持久化在 control-plane 连接。
@Module({
  imports: [TypeOrmModule.forFeature([ConnectorAuditDigest], "controlplane")],
  providers: [ConnectorAuditService],
  exports: [ConnectorAuditService],
})
export class ConnectorAuditModule {}
