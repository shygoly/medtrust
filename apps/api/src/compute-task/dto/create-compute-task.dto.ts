import { IsString, IsEnum, IsOptional, IsNumber } from "class-validator";
import { ComputeMethod, WorkloadType } from "@medtrust/database";
import { SecretFlowTaskSpec } from "./secretflow-task-spec";
import { FlPredictionTaskSpec } from "./fl-prediction-task-spec";
import { RwsAnalysisSpec } from "./rws-analysis-spec";

export interface ComputeTaskAlgorithmParams {
  analysis?: RwsAnalysisSpec;
  secretflowSpec?: SecretFlowTaskSpec;
  flPredictionSpec?: FlPredictionTaskSpec;
  [key: string]: unknown;
}

export class CreateComputeTaskDto {
  @IsString()
  name: string;

  @IsEnum(ComputeMethod)
  method: ComputeMethod;

  @IsOptional()
  @IsEnum(WorkloadType)
  workloadType?: WorkloadType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  algorithmParams?: ComputeTaskAlgorithmParams;

  @IsOptional()
  dataAssets?: any;

  @IsOptional()
  @IsNumber()
  requestId?: number;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  dataProductId?: string;
}
