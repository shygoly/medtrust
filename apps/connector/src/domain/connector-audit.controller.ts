import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService, AuditEntry } from './audit';
import { ConnectorTokenGuard } from './connector-token.guard';

@Controller('connector')
@UseGuards(ConnectorTokenGuard)
export class ConnectorAuditController {
  constructor(private readonly audit: AuditService) {}

  /** Local audit trail for debugging task execution (PEP, ingest, output-gate). */
  @Get('audit')
  list(@Query('taskId') taskId?: string): AuditEntry[] {
    const entries = this.audit.all();
    if (!taskId) return entries.slice(-100);
    return entries
      .filter((e: AuditEntry) => e.actor === taskId || e.detail?.includes(taskId))
      .slice(-100);
  }
}
