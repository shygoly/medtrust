import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ArrayNotEmpty,
} from "class-validator";

/** 授予数据产品访问权（产品级 ACL，D-ACL-1）。 */
export class GrantDataAccessDto {
  /** 授权标的：数据产品 id。 */
  @IsString()
  dataProductId!: string;

  /** 被授权参与方（使用方）。 */
  @IsString()
  granteeParticipantId!: string;

  /** 权限位：catalog=可见于目录 / compute=可发起作业。缺省 [compute]。 */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(["catalog", "compute"], { each: true })
  permissions?: Array<"catalog" | "compute">;

  /** 目的限定（可选）：填了只对该用途的作业有效。 */
  @IsOptional()
  @IsString()
  purpose?: string;

  /** ISO 到期时间（可选）；必须是将来时间。 */
  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
