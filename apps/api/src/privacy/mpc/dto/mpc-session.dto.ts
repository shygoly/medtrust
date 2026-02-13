import { IsString, IsEnum, IsArray, IsOptional, IsNumber, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum MpcComputationType {
  SECURE_SUM = 'secure_sum',
  SECURE_MEAN = 'secure_mean',
}

class ParticipantDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  party_id: number;

  @ApiProperty({ example: 1 })
  @IsNumber()
  tenant_id: number;

  @ApiProperty({ example: 'https://hospital1.example.com' })
  @IsString()
  endpoint: string;
}

export class CreateMpcSessionDto {
  @ApiProperty({ example: 'Cross-hospital patient count' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Compute total patient count across 3 hospitals', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: MpcComputationType, example: MpcComputationType.SECURE_SUM })
  @IsEnum(MpcComputationType)
  computation_type: MpcComputationType;

  @ApiProperty({ type: [ParticipantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];

  @ApiProperty({ example: 300, required: false })
  @IsOptional()
  @IsNumber()
  @Min(60)
  timeout_seconds?: number;
}

export class SubmitShareDto {
  @ApiProperty({ example: 0 })
  @IsNumber()
  party_id: number;

  @ApiProperty({ example: 150.5 })
  @IsNumber()
  value: number;
}

export class MpcSessionResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  session_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  computation_type: string;

  @ApiProperty()
  total_participants: number;

  @ApiProperty()
  shares_received: number;

  @ApiProperty({ required: false })
  result?: number;

  @ApiProperty({ required: false })
  error_message?: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ required: false })
  expires_at?: Date;

  @ApiProperty({ required: false })
  completed_at?: Date;
}
