import { IsString, IsEnum, IsOptional, IsObject } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { FLTaskStatus } from "../types";

export class UpdateFLTaskDto {
  @ApiPropertyOptional({
    description: "任务状态",
    enum: FLTaskStatus,
    example: FLTaskStatus.RUNNING,
  })
  @IsOptional()
  @IsEnum(FLTaskStatus)
  status?: FLTaskStatus;

  @ApiPropertyOptional({
    description: "进度信息",
    example: {
      currentRound: 5,
      totalRounds: 10,
      metrics: { loss: 0.45, accuracy: 0.82 },
    },
  })
  @IsOptional()
  @IsObject()
  progress?: {
    currentRound: number;
    totalRounds: number;
    currentClient?: string;
    metrics?: Record<string, number>;
  };

  @ApiPropertyOptional({
    description: "Flower 任务 ID",
    example: "flower-task-abc123",
  })
  @IsOptional()
  @IsString()
  flowerTaskId?: string;

  @ApiPropertyOptional({
    description: "结果摘要",
    example: { finalAccuracy: 0.88, roundsCompleted: 10 },
  })
  @IsOptional()
  @IsObject()
  resultSummary?: any;

  @ApiPropertyOptional({
    description: "错误消息",
    example: "Connection timeout",
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;
}
