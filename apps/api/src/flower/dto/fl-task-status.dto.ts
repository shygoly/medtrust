import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsNumber,
  IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { FLTaskStatus } from "../types";

class ProgressMetricsDto {
  @ApiProperty({
    description: "当前轮次",
    example: 5,
  })
  @IsNumber()
  currentRound: number;

  @ApiProperty({
    description: "总轮次",
    example: 10,
  })
  @IsNumber()
  totalRounds: number;

  @ApiPropertyOptional({
    description: "当前客户端 ID",
    example: "client-001",
  })
  @IsOptional()
  @IsString()
  currentClient?: string;

  @ApiPropertyOptional({
    description: "当前轮次指标",
    example: { loss: 0.45, accuracy: 0.82 },
  })
  @IsOptional()
  @IsObject()
  metrics?: Record<string, number>;
}

export class FLTaskStatusDto {
  @ApiProperty({
    description: "任务 ID",
    example: "fl-task-123456789",
  })
  @IsString()
  taskId: string;

  @ApiProperty({
    description: "任务状态",
    enum: FLTaskStatus,
    example: FLTaskStatus.RUNNING,
  })
  @IsEnum(FLTaskStatus)
  status: FLTaskStatus;

  @ApiPropertyOptional({
    description: "进度信息",
    type: ProgressMetricsDto,
  })
  @IsOptional()
  @IsObject()
  progress?: ProgressMetricsDto;

  @ApiPropertyOptional({
    description: "开始时间",
    example: "2024-01-15T10:30:00Z",
  })
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @ApiPropertyOptional({
    description: "完成时间",
    example: "2024-01-15T11:45:00Z",
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({
    description: "错误消息",
    example: "Connection timeout",
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional({
    description: "Flower 服务器 ID",
    example: "flower-server-001",
  })
  @IsOptional()
  @IsString()
  flowerServerId?: string;
}
