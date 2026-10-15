// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  CollaborationEntity,
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

/** 调用方身份按主体类型分开，机构 id 和用户 id 即使字符串相同也不互相认。 */
export interface ExchangeCaller {
  readonly orgId?: string;
  readonly userId?: string;
}

export interface ExchangeAttemptInput {
  spaceId: string;
  applicationId: string;
  caller: ExchangeCaller;
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
    @InjectRepository(CollaborationEntity, "controlplane")
    private readonly collaborations: Repository<CollaborationEntity>,
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
    const caller = this.matchCaller(members, input.caller);
    if (!caller) {
      return this.record(
        input.spaceId,
        contract?.id ?? null,
        "not-space-member",
      );
    }
    const covered = this.cover(input.spaceId, input.applicationId, contract);
    if (!covered || !contract) {
      return this.record(input.spaceId, contract?.id ?? null, "no-contract");
    }
    if (
      caller.subjectId !== contract.consumerId &&
      caller.subjectId !== contract.providerId
    ) {
      return this.record(input.spaceId, contract.id, "not-contract-party");
    }
    if (
      !(await this.inScenarioCollaboration(
        input.spaceId,
        input.applicationId,
        caller.subjectId,
      ))
    ) {
      return this.record(
        input.spaceId,
        contract.id,
        "not-collaboration-member",
      );
    }
    const decision = admitExchange({
      applicationId: input.applicationId,
      callerSubjectId: caller.subjectId,
      spaceMemberIds: [caller.subjectId],
      contract: covered,
      operatorDigest: input.operatorDigest,
      outputFields: input.outputFields,
      registeredDigests: this.registeredDigests(input.spaceId),
    });
    return this.record(
      input.spaceId,
      decision.contractId,
      decision.rejection,
      decision.mergePoint,
      decision.outputHash,
    );
  }

  private record(
    spaceId: string,
    contractId: string | null,
    rejection: string | null,
    mergePoint: string | null = null,
    outputHash: string | null = null,
  ): Promise<ExchangeAttemptEntity> {
    return this.attempts.save(
      this.attempts.create({
        spaceId,
        contractId,
        mergePoint,
        outputHash,
        rejection,
      }),
    );
  }

  /**
   * 机构成员和用户成员分开认。只在类型和 id 都对上时才算该主体。
   * 两边都对上时用机构：合约当事方和协作参与方记的是机构 id。
   */
  private matchCaller(
    members: readonly SpaceMemberEntity[],
    caller: ExchangeCaller,
  ): { subjectType: "org" | "user"; subjectId: string } | null {
    const orgId = caller.orgId?.trim();
    if (orgId) {
      const org = members.find(
        (member) => member.subjectType === "org" && member.subjectId === orgId,
      );
      if (org) return { subjectType: "org", subjectId: org.subjectId };
    }
    const userId = caller.userId?.trim();
    if (userId) {
      const user = members.find(
        (member) =>
          member.subjectType === "user" && member.subjectId === userId,
      );
      if (user) return { subjectType: "user", subjectId: user.subjectId };
    }
    return null;
  }

  private async inScenarioCollaboration(
    spaceId: string,
    applicationId: string,
    subjectId: string,
  ): Promise<boolean> {
    const app = POWER_APPLICATIONS.find((item) => item.id === applicationId);
    if (!app) return false;
    const productIds = new Set(
      powerCatalogProducts()
        .filter((product) => product.scenarioId === app.scenarioId)
        .map((product) => product.id),
    );
    const rows = await this.collaborations.find({
      where: { spaceId, status: "active" },
    });
    return rows.some(
      (row) =>
        (row.participants ?? []).includes(subjectId) &&
        (row.dataProductIds ?? []).some((id) => productIds.has(id)),
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
