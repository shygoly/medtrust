import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from "class-validator";

/** 使用方发起访问申请（D-ACL-1：申请只是发起，授予仍由提供方批准）。 */
export class CreateAccessRequestDto {
  @IsString()
  dataProductId!: string;

  /** 申请的权限位：catalog=查看目录 / compute=可计算。缺省 [compute]。 */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(["catalog", "compute"], { each: true })
  permissions?: Array<"catalog" | "compute">;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** 审批申请：批准可带到期日与备注；拒绝必须给原因。 */
export class ApproveAccessRequestDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class RejectAccessRequestDto {
  @IsString()
  reason!: string;
}
