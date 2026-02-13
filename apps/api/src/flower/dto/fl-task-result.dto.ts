import { IsString, IsEnum, IsOptional, IsObject, IsNumber, IsDateString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FLTaskStatus } from '../types';

class ClientMetricsDto {
  @ApiProperty({
    description: '客户端 ID',
    example: 'client-001',
  })
  @IsString()
  clientId: string;

  @ApiProperty({
    description: '客户端指标',
    example: { loss: 0.42, accuracy: 0.85 },
  })
  @IsObject()
  metrics: Record<string, number>;
}

class MetricsDto {
  @ApiPropertyOptional({
    description: '最终损失',
    example: 0.38,
  })
  @IsOptional()
  @IsNumber()
  finalLoss?: number;

  @ApiPropertyOptional({
    description: '最终准确率',
    example: 0.88,
  })
  @IsOptional()
  @IsNumber()
  finalAccuracy?: number;

  @ApiProperty({
    description: '完成轮次',
    example: 10,
  })
  @IsNumber()
  roundsCompleted: number;

  @ApiProperty({
    description: '客户端指标列表',
    type: [ClientMetricsDto],
  })
  @IsArray()
  clientMetrics: ClientMetricsDto[];
}

class ModelArtifactsDto {
  @ApiProperty({
    description: '模型文件 URL',
    example: 'https://storage.medtrust.com/models/fl-task-123/model.pkl',
  })
  @IsString()
  modelUrl: string;

  @ApiProperty({
    description: '检查点文件 URL',
    example: 'https://storage.medtrust.com/models/fl-task-123/checkpoint.pkl',
  })
  @IsString()
  checkpointUrl: string;

  @ApiProperty({
    description: '模型大小（字节）',
    example: 5242880,
  })
  @IsNumber()
  size: number;
}

export class FLTaskResultDto {
  @ApiProperty({
    description: '任务 ID',
    example: 'fl-task-123456789',
  })
  @IsString()
  taskId: string;

  @ApiProperty({
    description: '任务状态',
    enum: FLTaskStatus,
    example: FLTaskStatus.COMPLETED,
  })
  @IsEnum(FLTaskStatus)
  status: FLTaskStatus.COMPLETED | FLTaskStatus.FAILED | FLTaskStatus.CANCELLED;

  @ApiProperty({
    description: '训练指标',
    type: MetricsDto,
  })
  @IsObject()
  metrics: MetricsDto;

  @ApiPropertyOptional({
    description: '模型产物',
    type: ModelArtifactsDto,
  })
  @IsOptional()
  @IsObject()
  modelArtifacts?: ModelArtifactsDto;

  @ApiPropertyOptional({
    description: '完成时间',
    example: '2024-01-15T11:45:00Z',
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({
    description: '错误消息',
    example: 'Training failed due to insufficient data',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;
}
