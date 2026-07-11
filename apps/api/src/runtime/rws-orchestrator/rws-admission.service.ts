import { ForbiddenException, Injectable } from "@nestjs/common";
import { DigitalContract } from "@medtrust/database";
import { ContractService } from "../digital-contract/contract.service";

@Injectable()
export class RwsAdmissionService {
  constructor(private readonly contracts: ContractService) {}

  /**
   * Fail-closed: every referenced contract must be active, match consumer + purpose.
   * Returns one contract per provider target.
   */
  async admit(
    contractIds: string[],
    consumerId: string,
    purpose: string,
  ): Promise<DigitalContract[]> {
    if (!contractIds.length) {
      throw new ForbiddenException("RWS 任务至少引用一份数字合约");
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
      if (contract.purpose !== purpose) {
        throw new ForbiddenException(
          `数字合约 ${contract.id} 目的不符: 合约=${contract.purpose}, 任务=${purpose}`,
        );
      }
      matched.push(contract);
    }

    const providers = new Set(matched.map((c) => c.providerId));
    if (providers.size !== matched.length) {
      throw new ForbiddenException("同一提供方不可重复引用多份合约");
    }

    return matched;
  }
}
