import {
  IsArray,
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { FlPredictionTaskSpec } from "../../../compute-task/dto/fl-prediction-task-spec";

export class OrchestrateFlPredictionTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsDefined()
  @IsObject()
  flPredictionSpec!: FlPredictionTaskSpec;

  @IsArray()
  @IsString({ each: true })
  contractIds!: string[];

  @IsOptional()
  @IsNumber()
  computeTaskId?: number;
}
