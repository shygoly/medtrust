// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ExchangeAttemptEntity } from "@medtrust/database";
import { admitExchange, type ExchangeRequest } from "@medtrust/domain-power";

/**
 * 把一次计算尝试收成四字段记录。调用方不是空间成员、没有覆盖输入的有效合约、
 * 或算子没有复现摘要时，记录拒绝原因，不产生计算结果。
 */
@Injectable()
export class ExchangeAttemptService {
  constructor(
    @InjectRepository(ExchangeAttemptEntity, "controlplane")
    private readonly attempts: Repository<ExchangeAttemptEntity>,
  ) {}

  async record(input: ExchangeRequest): Promise<ExchangeAttemptEntity> {
    const decision = admitExchange(input);
    return this.attempts.save(
      this.attempts.create({
        contractId: decision.contractId,
        mergePoint: decision.mergePoint,
        outputHash: decision.outputHash,
        rejection: decision.rejection,
      }),
    );
  }
}
