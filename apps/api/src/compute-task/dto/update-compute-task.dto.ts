import { IsString, IsEnum, IsOptional, IsNumber } from "class-validator";
import { ComputeTaskStatus } from "@medtrust/database";

export class UpdateComputeTaskDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  algorithmParams?: any;

  @IsOptional()
  dataAssets?: any;
}

export class UpdateTaskStatusDto {
  @IsEnum(ComputeTaskStatus)
  status: ComputeTaskStatus;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  resultSummary?: any;

  @IsOptional()
  @IsNumber()
  progress?: number;
}
