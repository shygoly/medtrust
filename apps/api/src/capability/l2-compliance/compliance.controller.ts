import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ComplianceService } from "./compliance.service";
import { CreateCompositionDto } from "./dto/create-composition.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

// 组合 + L2 合规裁决(任务设计 / 合规视图的数据源)。全局前缀 /api/v1。
@Controller()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post("composition")
  @UseGuards(JwtAuthGuard)
  create(
    @Body() dto: CreateCompositionDto,
    @CurrentUser("participantId") ownerParticipantId?: string,
  ) {
    // 记录预审归属（数据使用方），供合约申请校验「预审属于该药企」（D-CMP-2）。
    return this.compliance.createComposition(dto, ownerParticipantId);
  }

  // 「用此预审申请合约」选择器：列出当前数据使用方创建的预审 + 最近裁决（D-CMP-2）。
  @Get("compositions")
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser("participantId") ownerParticipantId: string) {
    return this.compliance.listByOwner(ownerParticipantId ?? "");
  }

  @Get("composition/:id")
  async get(@Param("id") id: string) {
    const c = await this.compliance.getComposition(id);
    if (!c) throw new NotFoundException(`composition ${id} 不存在`);
    return c;
  }

  // 对一个组合做 L2 裁决并持久化评估结果。
  @Post("compliance/evaluate/:compositionId")
  evaluate(@Param("compositionId") compositionId: string) {
    return this.compliance.evaluate(compositionId);
  }

  // 取该组合最近一次评估。
  @Get("compliance/evaluation/:compositionId")
  async evaluation(@Param("compositionId") compositionId: string) {
    const e = await this.compliance.getEvaluation(compositionId);
    if (!e)
      throw new NotFoundException(`composition ${compositionId} 尚无评估`);
    return e;
  }
}
