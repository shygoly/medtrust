import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsNumber,
  ValidateNested,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

export enum FLType {
  HORIZONTAL = "horizontal",
  VERTICAL = "vertical",
}

export enum FLAlgorithm {
  LOGISTIC_REGRESSION = "logistic_regression",
  NEURAL_NETWORK = "neural_network",
  SECURE_BOOST = "secure_boost",
}

class ParticipantDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  party_id: number;

  @ApiProperty({ example: "guest" })
  @IsString()
  role: string;

  @ApiProperty({ example: "https://hospital1.example.com" })
  @IsString()
  endpoint: string;
}

class TrainingParamsDto {
  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  epochs?: number;

  @ApiProperty({ example: 32, required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  batch_size?: number;

  @ApiProperty({ example: 0.01, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  learning_rate?: number;

  @ApiProperty({ example: 1.0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  privacy_budget?: number;
}

class DatasetRefDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  party_id: number;

  @ApiProperty({ example: "dataset_123" })
  @IsString()
  dataset_id: string;

  @ApiProperty({ example: ["age", "gender", "diagnosis"] })
  @IsArray()
  @IsString({ each: true })
  features: string[];
}

export class CreateFLJobDto {
  @ApiProperty({ example: "Cross-hospital diabetes prediction" })
  @IsString()
  name: string;

  @ApiProperty({ example: "Train model across 3 hospitals", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: FLType, example: FLType.HORIZONTAL })
  @IsEnum(FLType)
  fl_type: FLType;

  @ApiProperty({ enum: FLAlgorithm, example: FLAlgorithm.LOGISTIC_REGRESSION })
  @IsEnum(FLAlgorithm)
  algorithm: FLAlgorithm;

  @ApiProperty({ type: [ParticipantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];

  @ApiProperty({ type: TrainingParamsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => TrainingParamsDto)
  training_params?: TrainingParamsDto;

  @ApiProperty({ type: [DatasetRefDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DatasetRefDto)
  dataset_refs?: DatasetRefDto[];
}

export class FLJobResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  fl_type: string;

  @ApiProperty()
  algorithm: string;

  @ApiProperty({ required: false })
  fate_job_id?: string;

  @ApiProperty({ required: false })
  current_epoch?: number;

  @ApiProperty({ required: false })
  total_epochs?: number;

  @ApiProperty({ required: false })
  progress_percentage?: number;

  @ApiProperty({ required: false })
  model_path?: string;

  @ApiProperty({ required: false })
  model_metrics?: any;

  @ApiProperty({ required: false })
  error_message?: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ required: false })
  started_at?: Date;

  @ApiProperty({ required: false })
  completed_at?: Date;
}
