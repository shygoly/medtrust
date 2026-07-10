import { Injectable } from '@nestjs/common';
import { AuditService } from './audit';
import { ContractView } from './contract-view';
import { RwsAnalysisLevel, RwsArtifactKind } from './types';

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyViolation';
  }
}

export interface TaskForCheck {
  taskId: string;
  purpose: string;
  level?: RwsAnalysisLevel; // 分析分级(rws-analytics-ladder)
  artifacts?: RwsArtifactKind[]; // 请求出域的产物类别
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
    // 分析分级授权 (rws-analytics-ladder): 合约声明了允许层级/产物时,越界即拒.
    if (contract.allowedLevels && task.level && !contract.allowedLevels.includes(task.level)) {
      return deny(`分析层级越权:合约允许=${contract.allowedLevels.join('/')},任务=${task.level}`);
    }
    if (contract.allowedArtifacts && task.artifacts) {
      const bad = task.artifacts.filter((a) => !contract.allowedArtifacts!.includes(a));
      if (bad.length) {
        return deny(`产物越权:${bad.join(',')} 不在合约白名单`);
      }
    }
    this.audit.record({ action: 'pep-pass', actor: task.taskId, allowed: true, detail: `目的=${task.purpose}` });
  }
}
