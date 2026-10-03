import { IsNotEmpty, IsObject, IsString, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Request body for POST /api/v1/result-interpreter/interpret.
 * `result` 的字段白名单由 c3ResultSchema（zod strict）校验，这里只把住外层形状。
 */
export class InterpretResultDto {
  @ApiProperty({
    description: "研究问题（自由文本）",
    example: "SGLT2 抑制剂暴露与心衰住院的关联",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question: string;

  @ApiProperty({
    description:
      "已发布的聚合结果（C3）；仅接受 paired-cohort / disproportionality / vaccine-scri 的聚合字段",
  })
  @IsObject()
  result: Record<string, unknown>;
}
