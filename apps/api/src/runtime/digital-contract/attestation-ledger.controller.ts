import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  AttestationLedgerRow,
  AttestationLedgerService,
} from "./attestation-ledger.service";

// 存证账本端点：列出真实上链的存证指针（类别 / 哈希 / 交易号 / 区块 / 时间）。
// 按当前用户的参与方角色控权——运营 / 合规见全部，提供方 / 使用方只见自己参与的对象。
@ApiTags("attestations")
@ApiBearerAuth()
@Controller("attestations")
@UseGuards(JwtAuthGuard)
export class AttestationLedgerController {
  constructor(private readonly ledger: AttestationLedgerService) {}

  @Get()
  @ApiOperation({ summary: "存证账本 — 真实链上存证指针（按角色控权）" })
  list(
    @CurrentUser() user: { role?: string; participantId?: string },
  ): Promise<AttestationLedgerRow[]> {
    return this.ledger.list({
      role: user?.role,
      participantId: user?.participantId,
    });
  }
}
