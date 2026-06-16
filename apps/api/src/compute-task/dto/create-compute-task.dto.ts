import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { ComputeMethod, WorkloadType } from '@medtrust/database';
import { SecretFlowTaskSpec } from './secretflow-task-spec';

export interface ComputeTaskAlgorithmParams {
  analysis?: { type: string };
  secretflowSpec?: SecretFlowTaskSpec;
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
