// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import {
  Body,
  Controller,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { SpaceAccessGuard } from "../space/space-access.guard";
import { ExchangeAttemptService } from "./exchange-attempt.service";

/**
 * 发起一次电力计算尝试。成员资格由空间门校验；
 * 合约是否覆盖输入、摘要是否已登记，由 ExchangeAttemptService 自己查。
 */
@ApiTags("space-exchange")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtAuthGuard, SpaceAccessGuard, ParticipantRolesGuard)
export class ExchangeAttemptController {
  constructor(private readonly exchanges: ExchangeAttemptService) {}

  @Post(":spaceId/exchanges")
  attempt(
    @Param("spaceId") spaceId: string,
    @Body()
    body: {
      applicationId: string;
      contractId: string;
      operatorDigest?: string;
      outputFields?: string[];
    },
    @Request()
    req: { user?: { participantId?: string; userId?: number | string } },
  ) {
    const caller =
      (typeof req.user?.participantId === "string" &&
        req.user.participantId.trim()) ||
      (req.user?.userId != null ? String(req.user.userId) : "");
    return this.exchanges.attempt({
      spaceId,
      applicationId: body.applicationId,
      contractId: body.contractId,
      operatorDigest: body.operatorDigest,
      outputFields: body.outputFields,
      callerSubjectId: caller,
    });
  }
}
