import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { TaskScratch } from './task-scratch';
import { ContractView } from './contract-view';

export const BURN_AFTER_READING = '阅后即焚';

// 留存约束强制 (usage-control 4.5). Applies the contract's retention rule to a
// task's intermediate data once the task finishes.
@Injectable()
export class RetentionEnforcer {
  constructor(
    private readonly scratch: TaskScratch,
    private readonly audit: AuditService,
  ) {}

  apply(contract: ContractView, taskId: string): void {
    if (contract.retention === BURN_AFTER_READING) {
      this.scratch.purge(taskId);
      this.audit.record({ action: 'retention-purge', actor: taskId, allowed: true, detail: '阅后即焚:已销毁中间数据' });
    }
  }
}
