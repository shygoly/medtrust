import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { ComputeMethod } from '@medtrust/database';

export class CreateComputeTaskDto {
  @IsString()
  name: string;

  @IsEnum(ComputeMethod)
  method: ComputeMethod;

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
}
