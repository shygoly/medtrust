import { Type } from "class-transformer";
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/** Optional structured egress policy override (else derived from `output`). */
class OutputPolicyDto {
  @IsOptional()
  @IsString()
  preset?: "aggregate_only" | "model_only" | "aggregate_and_model";

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(20)
  minCell?: number;
}

/** 药企（consumer）发起数字合约申请 */
export class RequestContractDto {
  @IsString()
  dataProductId!: string;

  /** 引用的合规预审组合 ID（D-CMP-2）：必须是本方创建的预审。 */
  @IsString()
  compositionId!: string;

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
}
