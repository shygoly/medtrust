import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request body for POST /api/v1/secretflow/assistant/draft.
 * Global ValidationPipe runs with forbidNonWhitelisted: true, so every field
 * must be decorated and no extra fields are accepted.
 */
export class DraftSecretFlowSpecDto {
  @ApiProperty({ description: '自然语言研究意图描述', example: '恒瑞医药联合华山、瑞金、中山医院，基于 eGFR/UACR 与肾活检 WSI 联邦微调 Meditron-7B 做 CKD 进展预测' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description: string;

  @ApiPropertyOptional({ description: '目的限定（purpose），用于后续合约校验' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  purpose?: string;
}
