import { Controller, Get, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { SettlementService } from "./settlement.service";

// 结算台账端点。按当前用户的参与方角色返回不同视图(10.5)。
@ApiTags("settlements")
@ApiBearerAuth()
@Controller("settlements")
@UseGuards(JwtAuthGuard)
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  list(@Request() req: any) {
    return this.settlement.list(req.user);
  }
}
