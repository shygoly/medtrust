import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InterpretResultDto } from "./dto/interpret-result.dto";
import { ResultInterpreterService } from "./result-interpreter.service";

@ApiTags("result-interpreter")
@ApiBearerAuth()
@Controller("result-interpreter")
@UseGuards(JwtAuthGuard)
export class ResultInterpreterController {
  constructor(private readonly interpreter: ResultInterpreterService) {}

  @Post("interpret")
  @ApiOperation({
    summary:
      "已发布的聚合结果（C3）→ 研究解读草稿（自托管推理；派生量由服务端计算，模型输出经数字回查）。",
  })
  interpret(@Body() body: InterpretResultDto) {
    return this.interpreter.interpret(body.question, body.result);
  }
}
