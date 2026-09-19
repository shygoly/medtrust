import { ForbiddenException, Injectable } from "@nestjs/common";
import { DigitalContract, LayerKind } from "@medtrust/database";
import { ComplianceService } from "./compliance.service";
import { CapabilityRegistryService } from "../registry.service";

export interface PreReviewTask {
  analysisType: string;
  /** 任务实际涉及的不同医院数（事实推导的参与机构数）。 */
  participantCount: number;
}

// 任务准入的合规预审复核（D-CMP-2 / design D1、D9）。对每份被引用的合约做三件事，全程 fail-closed：
// ① 合约必须带预审快照；② 任务分析类型须被预审组合中至少一个 L3 模型 / L4 算法登记覆盖（D4）；
// ③ 用任务层事实（参与机构数）按【当前】L2 规则重裁决——驳回即拒，需审批仅在合约有医院确认时放行。
@Injectable()
export class PreReviewGate {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly registry: CapabilityRegistryService,
  ) {}

  async check(contract: DigitalContract, task: PreReviewTask): Promise<void> {
    const snapshot = contract.preReview;
    if (!snapshot) {
      throw new ForbiddenException(
        `合约 ${contract.id} 无合规预审快照：不能用于创建新任务，请重新申请带预审的合约`,
      );
    }
    const composition = await this.compliance.getComposition(
      snapshot.compositionId,
    );
    if (!composition) {
      throw new ForbiddenException(
        `合约 ${contract.id} 的预审组合 ${snapshot.compositionId} 缺失，请重新申请`,
      );
    }

    // 范围检查：分析类型须被组合中某个能力对象登记（未登记映射亦拒，fail-closed）。
    const covered = await this.analysisTypeCovered(
      composition.modelKeys ?? [],
      composition.algorithmKeys ?? [],
      task.analysisType,
    );
    if (!covered) {
      throw new ForbiddenException(
        `合约 ${contract.id} 的预审未覆盖分析类型「${task.analysisType}」：超出预审范围或该类型未登记能力映射`,
      );
    }

    // 复评：任务层事实（参与机构数）+ 当前规则。规则收紧立即生效。
    let evaluation;
    try {
      evaluation = await this.compliance.evaluate(snapshot.compositionId, {
        participantCount: task.participantCount,
      });
    } catch {
      throw new ForbiddenException(
        `合约 ${contract.id} 的预审复评失败（组合或规则缺失），请重新申请`,
      );
    }
    if (evaluation.autoVerdict === "block") {
      throw new ForbiddenException(
        `合约 ${contract.id} 任务准入复审驳回：命中 ${evaluation.blockingRulesMatched.join("、") || "阻断规则"}`,
      );
    }
    if (evaluation.autoVerdict === "manual_review" && !contract.preReviewAck) {
      throw new ForbiddenException(
        `合约 ${contract.id} 复评为需审批，但合约无医院确认，不予放行`,
      );
    }
  }

  private async analysisTypeCovered(
    modelKeys: string[],
    algorithmKeys: string[],
    analysisType: string,
  ): Promise<boolean> {
    const layers: Array<[LayerKind, string[]]> = [
      [LayerKind.L3_MODEL, modelKeys],
      [LayerKind.L4_ALGORITHM, algorithmKeys],
    ];
    for (const [layer, keys] of layers) {
      for (const key of keys) {
        const obj = await this.registry.get(layer, key);
        const types = (obj?.metadata as { analysisTypes?: string[] } | null)
          ?.analysisTypes;
        if (Array.isArray(types) && types.includes(analysisType)) return true;
      }
    }
    return false;
  }
}
