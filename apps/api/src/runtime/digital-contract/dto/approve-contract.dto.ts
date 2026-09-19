import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

class OutputPolicyDto {
  @IsOptional()
  @IsString()
  preset?: "aggregate_only" | "model_only" | "aggregate_and_model";

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(20)
  minCell?: number;

  // DP 策略（与 @medtrust/database 的 OutputPolicy.dp 兼容；resolveOutputPolicy 消费）
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OutputDpPolicyDto)
  dp?:
    | { mode: "none" }
    | { mode: "epsilon"; epsilon: number; budgetScope: "per_task" };
}

class OutputDpPolicyDto {
  @IsString()
  @IsIn(["none", "epsilon"])
  mode!: "none" | "epsilon";

  @IsOptional()
  @IsNumber()
  epsilon?: number;

  @IsOptional()
  @IsString()
  @IsIn(["per_task"])
  budgetScope?: "per_task";
}

export class ApproveContractDto {
  @IsString()
  dataProductId!: string;

  @IsString()
  providerId!: string;

  @IsString()
  consumerId!: string;

  @IsString()
  purpose!: string;

  @IsString()
  retention!: string;

  @IsString()
  output!: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(20)
  minCell?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OutputPolicyDto)
  outputPolicy?: OutputPolicyDto;

  @IsInt()
  @Min(1)
  validDays!: number;

  /** algorithm-sandbox:固定算法模块条款(分析类型 → 模块 SM3)。 */
  @IsOptional()
  @IsObject()
  pinnedModules?: Record<string, string>;
}
