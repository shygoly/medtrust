import { IsString, IsEnum, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

export enum TeeComputationType {
  GENE_ANALYSIS = "gene_analysis",
  DRUG_EFFICACY = "drug_efficacy",
  CUSTOM = "custom",
}

export class CreateTeeComputationDto {
  @ApiProperty({ example: "Gene analysis for patient cohort" })
  @IsString()
  name: string;

  @ApiProperty({
    example: "Analyze genetic markers for diabetes risk",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: TeeComputationType,
    example: TeeComputationType.GENE_ANALYSIS,
  })
  @IsEnum(TeeComputationType)
  computation_type: TeeComputationType;

  @ApiProperty({
    example: { algorithm: "gwas", threshold: 0.05 },
    required: false,
  })
  @IsOptional()
  computation_params?: any;

  @ApiProperty({ example: "user-public-key-base64" })
  @IsString()
  user_public_key: string;
}

export class TeeComputationResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  computation_type: string;

  @ApiProperty({ required: false })
  instance_id?: string;

  @ApiProperty({ required: false })
  public_ip?: string;

  @ApiProperty({
    required: false,
    description: "未接入真实证明校验，恒为 false。不得解读为已通过远程证明。",
  })
  attestation_valid?: boolean;

  @ApiProperty({
    required: false,
    description: "最近一次校验时间；校验本身未接入真实实现，结论恒为失败。",
  })
  attestation_verified_at?: Date;

  @ApiProperty({ required: false })
  encrypted_output_path?: string;

  @ApiProperty({ required: false })
  cpu_hours?: number;

  @ApiProperty({ required: false })
  cost_cny?: number;

  @ApiProperty({ required: false })
  error_message?: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ required: false })
  started_at?: Date;

  @ApiProperty({ required: false })
  completed_at?: Date;
}

/** 未接入真实证明校验。`verified` 恒为 false，报告为占位 mock，不是厂商 quote。 */
export class AttestationResponseDto {
  @ApiProperty()
  instance_id: string;

  @ApiProperty({
    description:
      "占位 mock 报告（历史 SGX 形状），不是厂商 quote，不得当作远程证明。",
  })
  attestation_report: string;

  @ApiProperty({
    description: "未接入真实证明校验，恒判失败（false）。不得解读为已验证。",
  })
  verified: boolean;

  @ApiProperty({
    description: "最近一次校验时间；结论恒为失败。",
  })
  verified_at: Date;
}
