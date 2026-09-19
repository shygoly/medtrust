import { Injectable } from '@nestjs/common';
import {
  expandToPepArtifacts,
  levelsForPreset,
  resolveOutputPolicy,
  type OutputPolicy,
} from '@medtrust/database';
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
  /** algorithm-sandbox:分析类型(用于查合约固定的模块)。 */
  analysisType?: string;
  /** algorithm-sandbox:派发记录携带的模块 SM3。 */
  moduleSm3?: string;
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

    // Backfill structured egress from outputPolicy / legacy output label.
    const { allowedLevels, allowedArtifacts } = resolveContractAllowLists(contract);

    // 分析分级授权 (rws-analytics-ladder): 合约声明了允许层级/产物时,越界即拒.
    if (allowedLevels && task.level && !allowedLevels.includes(task.level)) {
      return deny(`分析层级越权:合约允许=${allowedLevels.join('/')},任务=${task.level}`);
    }
    if (allowedArtifacts && task.artifacts) {
      const bad = task.artifacts.filter((a) => !allowedArtifacts.includes(a));
      if (bad.length) {
        return deny(`产物越权:${bad.join(',')} 不在合约白名单`);
      }
    }

    // algorithm-sandbox / usage-control:合约固定了算法模块时,任务携带的模块 SM3
    // 必须存在且一致,否则拒绝执行 —— 不以内置实现代替。
    const pinned = task.analysisType
      ? contract.pinnedModules?.[task.analysisType]
      : undefined;
    if (pinned) {
      if (!task.moduleSm3) {
        return deny(
          `合约已为 ${task.analysisType} 固定算法模块 ${pinned},任务未携带模块引用 —— 拒绝执行(不以内置实现代替)`,
        );
      }
      if (task.moduleSm3.toLowerCase() !== pinned.toLowerCase()) {
        return deny(
          `模块不符:合约固定=${pinned},任务携带=${task.moduleSm3}`,
        );
      }
    }

    const minCell = contract.minCell ?? contract.outputPolicy?.minCell;
    this.audit.record({
      action: 'pep-pass',
      actor: task.taskId,
      allowed: true,
      detail: `目的=${task.purpose}${minCell != null ? ` minCell=${minCell}` : ''}`,
    });
  }
}

function resolveContractAllowLists(contract: ContractView): {
  allowedLevels?: RwsAnalysisLevel[];
  allowedArtifacts?: RwsArtifactKind[];
} {
  if (contract.allowedArtifacts?.length || contract.allowedLevels?.length) {
    return {
      allowedLevels: contract.allowedLevels,
      allowedArtifacts: contract.allowedArtifacts,
    };
  }
  if (!contract.outputPolicy && !contract.output) {
    return {};
  }
  const policy = resolveOutputPolicy({
    output: contract.output,
    outputPolicy: (contract.outputPolicy as Partial<OutputPolicy> | undefined) ?? null,
  });
  return {
    allowedLevels: levelsForPreset(policy.preset) as RwsAnalysisLevel[],
    allowedArtifacts: expandToPepArtifacts(policy) as RwsArtifactKind[],
  };
}
