import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessRequestStatus } from '@medtrust/database';

export class CreateAccessRequestDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  providerTenantId: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  assetId: number;

  @ApiProperty({ example: 'Research on lung cancer treatments' })
  @IsString()
  @IsNotEmpty()
  purpose: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  expectedDuration?: number;

  @ApiPropertyOptional({ example: 100.00 })
  @IsOptional()
  expectedCost?: number;
}
