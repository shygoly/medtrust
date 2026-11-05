import { Injectable } from '@nestjs/common';
import {
  expandToPepArtifacts,
  levelsForPreset,
  resolveOutputPolicy,
  type OutputPolicy,
} from '@medtrust/database';
import {
  findRevocation,
  pinnedModuleSm3,
  validatePinnedModuleClause,
  type RevocationList,
} from '@medtrust/wasm-algorithms';
import { AuditService } from './audit';
import { ContractView } from './contract-view';
import { decide } from './usage-control/engine';
import { policyFromContract, requestFromContract } from './usage-control/legacy';
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
  /**
   * 任务要取数的数据产品(如 FL 预测 spec 里本院 party 的 dataProductId)。
   * 声明了就必须恰为合约授权的那个——数据来源由合约决定,不由任务 spec 另指。
   */
  dataProductId?: string;
}

/** third-party-module-admission:PEP 执行前的吊销判据来源。 */
export interface RevocationSource {
  revocationList(): RevocationList;
}

// 策略执行点 PEP (usage-control 4.4). Runs on the connector before every
// computation. The task may proceed only under a matching, active, unexpired
// digital contract; otherwise it is denied and audited.
@Injectable()
export class PolicyEnforcementPoint {
  constructor(
    private readonly audit: AuditService,
    /**
     * third-party-module-admission 闸 5:吊销判据来源(连接器的模块客户端)。
     * 未注入时 PEP 不做吊销判断 —— 由模块校验那一层兜底(verifyModule 也查名单)。
     */
    private readonly revocations?: RevocationSource,
  ) {}

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
    if (task.dataProductId !== undefined) {
      if (!contract.dataProductId) {
        return deny(`合约未指向数据产品,无从授权任务取数(任务声明=${task.dataProductId})`);
      }
      if (task.dataProductId !== contract.dataProductId) {
        return deny(
          `数据产品不符:合约授权=${contract.dataProductId},任务声明=${task.dataProductId}`,
        );
      }
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
    const pinnedSpec = task.analysisType
      ? contract.pinnedModules?.[task.analysisType]
      : undefined;
    if (pinnedSpec) {
      // third-party-module-admission:固定模块条款必须完整(SM3 + 层级 + 审查背书);
      // 缺层级或背书 = 固定了一个来路不明的模块 —— 拒(digital-contract 增量)。
      const clauseErr = validatePinnedModuleClause(
        task.analysisType ?? '',
        pinnedSpec,
      );
      if (clauseErr) return deny(`${clauseErr} —— 拒绝执行(不以内置实现代替)`);

      const pinned = pinnedModuleSm3(pinnedSpec);
      if (!task.moduleSm3) {
        return deny(
          `合约已为 ${task.analysisType} 固定算法模块 ${pinned},任务未携带模块引用 —— 拒绝执行(不以内置实现代替)`,
        );
      }
      if (task.moduleSm3.toLowerCase() !== pinned) {
        return deny(
          `模块不符:合约固定=${pinned},任务携带=${task.moduleSm3}`,
        );
      }
      // 闸 5:执行前吊销检查。吊销即拒,且**不回退到内置实现**。
      const hit = findRevocation(
        this.revocations?.revocationList(),
        task.moduleSm3,
      );
      if (hit) {
        return deny(
          `算法模块已吊销,拒绝执行且不回退到内置实现:sm3=${task.moduleSm3} ` +
            `reason=${hit.reason} at=${hit.revokedAt} by=${hit.revokedBy}`,
        );
      }
    }

    // ndi-usage-control-engine：缺省 legacy（行为与改造前完全一致）。
    // shadow = 只记录引擎与 legacy 的分歧，不改变结论；v1 = 引擎判定生效。
    const engineMode = (process.env.USAGE_CONTROL_ENGINE ?? 'legacy').trim().toLowerCase();
    if (engineMode === 'v1' || engineMode === 'shadow') {
      const evaluation = decide(
        policyFromContract(contract),
        requestFromContract(contract, { purpose: task.purpose, now }),
      );
      const denied =
        evaluation.decision === 'DENY' || evaluation.decision === 'DEFAULT_DENY';
      if (engineMode === 'shadow') {
        if (denied) {
          this.audit.record({
            action: 'usage-control-divergence',
            actor: task.taskId,
            allowed: true,
            detail: `legacy=allow engine=${evaluation.decision}:${evaluation.reason}`,
          });
        }
      } else if (denied) {
        return deny(`使用控制拒绝：${evaluation.reason}`);
      } else if (evaluation.decision === 'ALLOW_WITH_OBLIGATIONS') {
        // 义务事项的执行是异步的，由调用方在 compute 前履行；这里先留审计痕迹。
        this.audit.record({
          action: 'usage-control-obligations',
          actor: task.taskId,
          allowed: true,
          detail: evaluation.obligations.map((o) => o.kind).join(',') || '无',
        });
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
