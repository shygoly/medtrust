import { ForbiddenException, Injectable } from "@nestjs/common";
import { DigitalContract } from "@medtrust/database";
import { FlPredictionTaskSpec } from "../../compute-task/dto/fl-prediction-task-spec";
import { ContractService } from "../digital-contract/contract.service";
import { PreReviewGate } from "../../capability/l2-compliance/pre-review-gate";

@Injectable()
export class FlAdmissionService {
  constructor(
    private readonly contracts: ContractService,
    private readonly preReviewGate: PreReviewGate,
  ) {}

  /**
   * Fail-closed: contracts must cover every provider party in the FL spec.
   */
  async admit(
    contractIds: string[],
    consumerId: string,
    spec: FlPredictionTaskSpec,
  ): Promise<DigitalContract[]> {
    if (!contractIds.length) {
      throw new ForbiddenException("FL 预测任务至少引用一份数字合约");
    }
    if (!consumerId) {
      throw new ForbiddenException("未绑定消费方参与方身份");
    }

    const resolved = (
      await Promise.all(contractIds.map((id) => this.contracts.get(id)))
    ).filter((c): c is DigitalContract => Boolean(c));

    if (resolved.length !== contractIds.length) {
      throw new ForbiddenException("存在无效的数字合约引用");
    }

    const matched: DigitalContract[] = [];
    for (const contract of resolved) {
      if (this.contracts.effectiveStatus(contract) !== "active") {
        throw new ForbiddenException(`数字合约 ${contract.id} 未生效或已过期`);
      }
      if (contract.consumerId !== consumerId) {
        throw new ForbiddenException(`数字合约 ${contract.id} 消费方不匹配`);
      }
      if (contract.purpose !== spec.purpose) {
        throw new ForbiddenException(
          `数字合约 ${contract.id} 目的不符: 合约=${contract.purpose}, 任务=${spec.purpose}`,
        );
      }
      matched.push(contract);
    }

    const providers = spec.parties.filter((p) => p.role === "provider");
    for (const party of providers) {
      const contract = matched.find(
        (c) => c.providerId === party.participantId,
      );
      if (!contract) {
        throw new ForbiddenException(
          `缺少提供方 ${party.participantId} 的数字合约`,
        );
      }
      if (contract.dataProductId !== party.dataProductId) {
        throw new ForbiddenException(
          `合约 ${contract.id} 数据产品 ${contract.dataProductId} 与 spec 中 ${party.dataProductId} 不一致`,
        );
      }
    }

    const providerIds = new Set(matched.map((c) => c.providerId));
    if (providerIds.size !== matched.length) {
      throw new ForbiddenException("同一提供方不可重复引用多份合约");
    }

    if (matched.length !== providers.length) {
      throw new ForbiddenException("合约数量须与 FL spec 中 provider 数量一致");
    }

    // D-CMP-2 预审复核：FL 预测任务，分析类型 fl-prediction；参与机构数 = provider 合约数。
    for (const contract of matched) {
      await this.preReviewGate.check(contract, {
        analysisType: "fl-prediction",
        participantCount: matched.length,
      });
    }

    return matched;
  }
}
