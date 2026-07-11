import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsDateString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { FLTaskStatus } from "../types";

export class FLTaskResponseDto {
  @ApiProperty({
    description: "任务 ID",
    example: "fl-task-123456789",
  })
  @IsString()
  taskId: string;

  @ApiProperty({
    description: "任务状态",
    enum: FLTaskStatus,
    example: FLTaskStatus.PENDING,
  })
  @IsEnum(FLTaskStatus)
  status: FLTaskStatus;

  @ApiProperty({
    description: "状态消息",
    example: "Task submitted successfully",
  })
  @IsString()
  message: string;

  @ApiProperty({
    description: "提交时间",
    example: "2024-01-15T10:30:00Z",
  })
  @IsDateString()
  submittedAt: string;

  @ApiPropertyOptional({
    description: "Flower 服务器分配的 ID",
    example: "flower-task-abc123",
  })
  @IsOptional()
  @IsString()
  flowerTaskId?: string;
}
