import { IsString, IsEnum, IsOptional, IsNumber, Min, Max, IsArray, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FLTaskType, FLModelType, FLAlgorithmType } from '../types';

export class FLTaskConfigDto {
  @ApiProperty({
    description: '任务类型',
    enum: FLTaskType,
    example: FLTaskType.CLASSIFICATION,
  })
  @IsEnum(FLTaskType)
  taskType: FLTaskType;

  @ApiProperty({
    description: '模型类型',
    enum: FLModelType,
    example: FLModelType.LOGISTIC_REGRESSION,
  })
  @IsEnum(FLModelType)
  modelType: FLModelType;

  @ApiProperty({
    description: '数据集配置',
    example: {
      dataAssetIds: ['asset-001', 'asset-002'],
      features: ['age', 'blood_pressure'],
      target: 'diagnosis',
    },
  })
  @IsObject()
  datasetConfig: {
    dataAssetIds: string[];
    features: string[];
    target: string;
  };

  @ApiProperty({
    description: '训练配置',
    example: {
      rounds: 10,
      clients: 5,
      learningRate: 0.001,
      batchSize: 32,
      epochs: 5,
      fractionFit: 0.8,
      fractionEvaluate: 0.5,
    },
  })
  @IsObject()
  trainingConfig: {
    rounds: number;
    clients: number;
    learningRate: number;
    batchSize: number;
    epochs: number;
    fractionFit: number;
    fractionEvaluate: number;
  };

  @ApiPropertyOptional({
    description: '聚合配置',
    example: {
      strategy: FLAlgorithmType.FEDAVG,
    },
  })
  @IsOptional()
  @IsObject()
  aggregationConfig?: {
    strategy: FLAlgorithmType;
    proximalMu?: number;
  };
}
