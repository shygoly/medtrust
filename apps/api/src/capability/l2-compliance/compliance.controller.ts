import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { ComplianceService } from "./compliance.service";
import { CreateCompositionDto } from "./dto/create-composition.dto";

// 组合 + L2 合规裁决(任务设计 / 合规视图的数据源)。全局前缀 /api/v1。
@Controller()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post("composition")
  create(@Body() dto: CreateCompositionDto) {
    return this.compliance.createComposition(dto);
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
