import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RwsAnalysisType } from '../types';

class RwsAnalysisDto {
  @IsString()
  type!: RwsAnalysisType;

  @IsOptional()
  @IsString()
  drug?: string;
}

export class OrchestrateRwsTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  purpose!: string;

  @ValidateNested()
  @Type(() => RwsAnalysisDto)
  analysis!: RwsAnalysisDto;

  @IsArray()
  @IsString({ each: true })
  contractIds!: string[];
}
