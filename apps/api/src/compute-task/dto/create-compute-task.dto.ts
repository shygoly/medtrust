import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { ComputeMethod, WorkloadType } from '@medtrust/database';

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
  algorithmParams?: any;

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
