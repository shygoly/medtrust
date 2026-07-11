import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsObject,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  FLTaskStatus,
  FLAlgorithmType,
  FLModelType,
  FLTaskType,
} from "../types";

class DatasetConfigDto {
  @ApiProperty({
    description: "数据资产 ID 列表",
    example: ["asset-001", "asset-002", "asset-003"],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  dataAssetIds: string[];

  @ApiProperty({
    description: "特征列名称列表",
    example: ["age", "blood_pressure", "heart_rate"],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  features: string[];

  @ApiProperty({
    description: "目标变量列名称",
    example: "diagnosis",
  })
  @IsString()
  target: string;
}

class TrainingConfigDto {
  @ApiProperty({
    description: "联邦学习轮数",
    example: 10,
    minimum: 1,
    maximum: 1000,
  })
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  rounds: number;

  @ApiProperty({
    description: "参与的客户端数量",
    example: 5,
    minimum: 2,
    maximum: 100,
  })
  @IsNumber()
  @Min(2)
  @Max(100)
  @Type(() => Number)
  clients: number;

  @ApiProperty({
    description: "学习率",
    example: 0.001,
    minimum: 0.0001,
    maximum: 1,
  })
  @IsNumber()
  @Min(0.0001)
  @Max(1)
  @Type(() => Number)
  learningRate: number;

  @ApiProperty({
    description: "批次大小",
    example: 32,
    minimum: 1,
    maximum: 1024,
  })
  @IsNumber()
  @Min(1)
  @Max(1024)
  @Type(() => Number)
  batchSize: number;

  @ApiProperty({
    description: "每轮本地训练轮数",
    example: 5,
    minimum: 1,
    maximum: 100,
  })
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  epochs: number;

  @ApiProperty({
    description: "每轮参与训练的客户端比例",
    example: 0.8,
    minimum: 0.1,
    maximum: 1,
  })
  @IsNumber()
  @Min(0.1)
  @Max(1)
  @Type(() => Number)
  fractionFit: number;

  @ApiProperty({
    description: "每轮参与评估的客户端比例",
    example: 0.5,
    minimum: 0.1,
    maximum: 1,
  })
  @IsNumber()
  @Min(0.1)
  @Max(1)
  @Type(() => Number)
  fractionEvaluate: number;
}

class AggregationConfigDto {
  @ApiProperty({
    description: "聚合策略",
    enum: FLAlgorithmType,
    example: FLAlgorithmType.FEDAVG,
  })
  @IsEnum(FLAlgorithmType)
  strategy: FLAlgorithmType;

  @ApiPropertyOptional({
    description: "FedProx 策略的近端项系数（仅当 strategy 为 fedprox 时使用）",
    example: 0.01,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  proximalMu?: number;
}

export class SubmitFLTaskDto {
  @ApiProperty({
    description: "任务类型",
    enum: FLTaskType,
    example: FLTaskType.CLASSIFICATION,
  })
  @IsEnum(FLTaskType)
  taskType: FLTaskType;

  @ApiProperty({
    description: "模型类型",
    enum: FLModelType,
    example: FLModelType.LOGISTIC_REGRESSION,
  })
  @IsEnum(FLModelType)
  modelType: FLModelType;

  @ApiProperty({
    description: "数据集配置",
    type: DatasetConfigDto,
  })
  @ValidateNested()
  @Type(() => DatasetConfigDto)
  datasetConfig: DatasetConfigDto;

  @ApiProperty({
    description: "训练配置",
    type: TrainingConfigDto,
  })
  @ValidateNested()
  @Type(() => TrainingConfigDto)
  trainingConfig: TrainingConfigDto;

  @ApiPropertyOptional({
    description: "聚合配置",
    type: AggregationConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AggregationConfigDto)
  aggregationConfig?: AggregationConfigDto;

  @ApiPropertyOptional({
    description: "计算任务名称",
    example: "心脏病风险评估联邦学习",
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "计算任务描述",
    example: "使用联邦学习进行多中心心脏病风险预测模型训练",
  })
  @IsOptional()
  @IsString()
  description?: string;
}
