import {
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  CAUSAL_METHODS,
  FEDERATION_MODES,
  RWS_ANALYSIS_LEVELS,
  RWS_ARTIFACT_KINDS,
  RwsAnalysisType,
} from "../../../compute-task/dto/rws-analysis-spec";

class TteOutcomeDto {
  @IsString()
  @IsIn(["time_to_event", "binary"])
  type!: "time_to_event" | "binary";

  @IsString()
  event!: string;
}

class TteDto {
  @IsString()
  exposureArm!: string;

  @IsString()
  comparatorArm!: string;

  @IsString()
  timeZeroRule!: string;

  @IsArray()
  @IsString({ each: true })
  inclusion!: string[];

  @IsArray()
  @IsString({ each: true })
  exclusion!: string[];

  @ValidateNested()
  @Type(() => TteOutcomeDto)
  outcome!: TteOutcomeDto;
}

class RwsAnalysisDto {
  @IsString()
  type!: RwsAnalysisType;

  @IsOptional()
  @IsIn([...RWS_ANALYSIS_LEVELS])
  level?: (typeof RWS_ANALYSIS_LEVELS)[number];

  @IsOptional()
  @IsIn([...FEDERATION_MODES])
  mode?: (typeof FEDERATION_MODES)[number];

  @IsOptional()
  @IsString()
  drug?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsIn(["adverse_event", "condition"])
  outcomeKind?: "adverse_event" | "condition";

  @IsOptional()
  @IsArray()
  @IsIn(["ageBand", "sex"], { each: true })
  stratifyBy?: Array<"ageBand" | "sex">;

  @IsOptional()
  @IsIn([...CAUSAL_METHODS])
  method?: (typeof CAUSAL_METHODS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => TteDto)
  tte?: TteDto;

  @IsOptional()
  @IsArray()
  @IsIn([...RWS_ARTIFACT_KINDS], { each: true })
  allowedArtifacts?: (typeof RWS_ARTIFACT_KINDS)[number][];
}

export class OrchestrateRwsTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  purpose!: string;

  // @ValidateNested() alone passes when the value is undefined — @IsDefined +
  // @IsObject make `analysis` genuinely required so a missing/old-shape spec
  // (analysisType/participants/...) yields a clean 400 instead of a handler 500.
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RwsAnalysisDto)
  analysis!: RwsAnalysisDto;

  @IsArray()
  @IsString({ each: true })
  contractIds!: string[];
}
