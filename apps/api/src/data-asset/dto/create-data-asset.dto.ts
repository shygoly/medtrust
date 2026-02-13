import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataAssetType } from '@medtrust/database';

export class CreateDataAssetDto {
  @ApiProperty({ example: 'Lung Cancer Dataset 2024' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Comprehensive lung cancer patient data' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: DataAssetType, example: DataAssetType.EMR })
  @IsEnum(DataAssetType)
  type: DataAssetType;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @IsNumber()
  recordCount?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  patientCount?: number;

  @ApiPropertyOptional({ example: 10.00 })
  @IsOptional()
  pricePerQuery?: number;

  @ApiPropertyOptional({ example: 50.00 })
  @IsOptional()
  pricePerCompute?: number;
}
