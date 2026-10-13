// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DigitalContractEntity,
  ExchangeAttemptEntity,
  SpaceMemberEntity,
} from "@medtrust/database";
import {
  admitExchange,
  POWER_APPLICATIONS,
  powerCatalogProducts,
  type ExchangeContract,
} from "@medtrust/domain-power";
import { SpacePackRegistryService } from "./space-pack-registry.service";

export interface ExchangeAttemptInput {
  spaceId: string;
  applicationId: string;
  callerSubjectId: string;
  contractId: string;
  operatorDigest?: string | null;
  outputFields?: readonly string[];
}

/**
 * 计算前准入。成员、合约和算子摘要都从库与已启用的包里读，不接受调用方自报。
 * 摘要必须是该空间已登记算子的摘要；只是 64 位十六进制不够。
 */
@Injectable()
export class ExchangeAttemptService {
  constructor(
    @InjectRepository(ExchangeAttemptEntity, "controlplane")
    private readonly attempts: Repository<ExchangeAttemptEntity>,
    @InjectRepository(SpaceMemberEntity, "controlplane")
    private readonly members: Repository<SpaceMemberEntity>,
    @InjectRepository(DigitalContractEntity, "controlplane")
    private readonly contracts: Repository<DigitalContractEntity>,
    private readonly packs: SpacePackRegistryService,
  ) {}

  async attempt(input: ExchangeAttemptInput): Promise<ExchangeAttemptEntity> {
    if (!input.spaceId?.trim()) throw new BadRequestException("缺少空间 id");
    if (!input.applicationId?.trim()) {
      throw new BadRequestException("缺少应用");
    }
    if (!input.contractId?.trim()) throw new BadRequestException("缺少合约");
    const members = await this.members.find({
      where: { spaceId: input.spaceId, status: "active" },
    });
    const contract = await this.contracts.findOne({
      where: { id: input.contractId },
    });
    const decision = admitExchange({
      applicationId: input.applicationId,
      callerSubjectId: input.callerSubjectId,
      spaceMemberIds: members.map((member) => member.subjectId),
      contract: this.cover(input.spaceId, input.applicationId, contract),
      operatorDigest: input.operatorDigest,
      outputFields: input.outputFields,
      registeredDigests: this.registeredDigests(input.spaceId),
    });
    return this.attempts.save(
      this.attempts.create({
        spaceId: input.spaceId,
        contractId: decision.contractId,
        mergePoint: decision.mergePoint,
        outputHash: decision.outputHash,
        rejection: decision.rejection,
      }),
    );
  }

  private cover(
    spaceId: string,
    applicationId: string,
    contract: DigitalContractEntity | null,
  ): ExchangeContract | null {
    if (!contract || contract.status !== "active") return null;
    if ((contract.spaceId || "") !== spaceId) return null;
    const app = POWER_APPLICATIONS.find((item) => item.id === applicationId);
    if (!app) return null;
    const productIds = new Set(
      powerCatalogProducts()
        .filter((product) => product.scenarioId === app.scenarioId)
        .map((product) => product.id),
    );
    if (!productIds.has(contract.dataProductId)) return null;
    const plaintext = contract.outputPolicy?.plaintextInputs ?? [];
    return {
      id: contract.id,
      status: contract.status,
      coversInputs: true,
      plaintextInputs: plaintext,
    };
  }

  private registeredDigests(spaceId: string): readonly string[] {
    const digests: string[] = [];
    for (const reg of this.packs.registry.enabled({ spaceId })) {
      const declared =
        reg.bundle.operators?.declareOperators({ spaceId }) ?? [];
      for (const operator of declared) {
        if (operator.digest?.trim()) digests.push(operator.digest.trim());
      }
    }
    return digests;
  }
}
