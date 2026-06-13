import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { ContractView } from './contract-view';

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyViolation';
  }
}

export interface TaskForCheck {
  taskId: string;
  purpose: string;
}

// 策略执行点 PEP (usage-control 4.4). Runs on the connector before every
// computation. The task may proceed only under a matching, active, unexpired
// digital contract; otherwise it is denied and audited.
@Injectable()
export class PolicyEnforcementPoint {
  constructor(private readonly audit: AuditService) {}

  check(task: TaskForCheck, contract: ContractView | undefined, now = Date.now()): void {
    const deny = (detail: string): never => {
      this.audit.record({ action: 'pep-deny', actor: task.taskId, allowed: false, detail });
      throw new PolicyViolation(detail);
    };

    if (!contract || contract.status === 'draft') return deny('无生效数字合约');
    if (contract.status === 'revoked') return deny('数字合约已撤销');
    if (new Date(contract.validUntil).getTime() < now) return deny('数字合约已过期');
    if (contract.purpose !== task.purpose) {
      return deny(`目的不符:合约目的=${contract.purpose},任务目的=${task.purpose}`);
    }
    this.audit.record({ action: 'pep-pass', actor: task.taskId, allowed: true, detail: `目的=${task.purpose}` });
  }
}
