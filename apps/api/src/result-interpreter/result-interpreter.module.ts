import { Module } from "@nestjs/common";
import { ResultInterpreterController } from "./result-interpreter.controller";
import { ResultInterpreterService } from "./result-interpreter.service";

/**
 * C3 结果解读（AGT-04）。与执行层解耦：只读调用方提交的已发布聚合结果，
 * 不取任何系统数据。Reads RESULT_INTERPRETER_LLM_* from the global ConfigModule.
 */
@Module({
  controllers: [ResultInterpreterController],
  providers: [ResultInterpreterService],
})
export class ResultInterpreterModule {}
