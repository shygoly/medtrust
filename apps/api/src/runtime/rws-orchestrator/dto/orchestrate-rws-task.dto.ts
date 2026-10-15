import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  CAUSAL_METHODS,
  FEDERATION_MODES,
  MATCHING_STRATEGIES,
  MISSINGNESS_MECHANISMS,
  RWS_ANALYSIS_LEVELS,
  RWS_ARTIFACT_KINDS,
  RWS_DESIGN_TYPES,
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

class CodeSetDto {
  @IsString()
  codeSystem!: string;

  @IsString()
  codeSystemVersion!: string;

  @IsArray()
  @IsString({ each: true })
  codes!: string[];

  @IsIn(["outpatient_dx", "discharge_dx", "lab", "medication"])
  valueSource!: "outpatient_dx" | "discharge_dx" | "lab" | "medication";

  @IsIn(["primary_only", "top3_discharge", "any"])
  diagnosisOrder!: "primary_only" | "top3_discharge" | "any";
}

class IdentificationAlgorithmDto {
  @IsString()
  id!: string;

  @IsString()
  version!: string;

  // Opaque on the control plane — the connector grammar-validates the
  // closed-grammar AST (CTL-10). Here we only enforce "is an object".
  @IsObject()
  expression!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  assessmentWindowDays?: string;
}

// rws-study-protocol-spec Phase 1 nested DTOs.

class SapDto {
  @IsNumber()
  significanceLevel!: number;

  @IsOptional()
  @IsNumber()
  power?: number;

  @IsOptional()
  @IsNumber()
  sampleSizeAssumption?: number;

  @IsOptional()
  @IsString()
  sampleSizeJustification?: string;

  @IsOptional()
  @IsString()
  multiplicityAlphaAdjustment?: string;
}

class MissingnessDto {
  @IsIn([...MISSINGNESS_MECHANISMS])
  mechanism!: "MCAR" | "MAR" | "MNAR";

  @IsString()
  imputationStrategy!: string;
}

class SensitivityAnalysisDto {
  @IsString()
  id!: string;

  @IsString()
  description!: string;
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

  // D-RWS-10 / P-EVD-11 — L3 因果匹配策略封闭枚举。这里只做白名单 + 值域
  // 登记；「L3 必填 / 非 L3 给了即拒 / 与通道实际配对行为一致」由服务层
  // validateRwsAnalysisLadder fail-closed 校验（那里的文案说明为什么拒）。
  @IsOptional()
  @IsIn([...MATCHING_STRATEGIES])
  matchingStrategy?: (typeof MATCHING_STRATEGIES)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => TteDto)
  tte?: TteDto;

  @IsOptional()
  @IsArray()
  @IsIn([...RWS_ARTIFACT_KINDS], { each: true })
  allowedArtifacts?: (typeof RWS_ARTIFACT_KINDS)[number][];

  // rws-algorithm-validation (L0)
  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationAlgorithmDto)
  algorithm?: IdentificationAlgorithmDto;

  @IsOptional()
  @IsString()
  variableDefinitionId?: string;

  @IsOptional()
  @IsString()
  goldStandardSetVersion?: string;

  // rws-study-protocol-spec (Phase 1 — all optional, no BREAKING).
  @IsOptional()
  @IsIn([...RWS_DESIGN_TYPES])
  designType?:
    | "cross-sectional"
    | "cohort"
    | "case-control"
    | "nested-case-control"
    | "case-cohort"
    | "case-crossover";

  @IsOptional()
  @IsString()
  rationale?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationAlgorithmDto)
  outcomeAlgorithm?: IdentificationAlgorithmDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationAlgorithmDto)
  exposureAlgorithm?: IdentificationAlgorithmDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentificationAlgorithmDto)
  comparatorAlgorithm?: IdentificationAlgorithmDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SapDto)
  sap?: SapDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MissingnessDto)
  missingness?: MissingnessDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SensitivityAnalysisDto)
  sensitivityAnalyses?: SensitivityAnalysisDto[];
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

/**
 * rws-study-protocol-spec Phase 3 — protocol revision. Creates a new
 * protocolVersion with the updated analysis; unfreezes (the new version
 * starts pending and is re-frozen on its first dispatch).
 */
export class ReviseRwsTaskDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RwsAnalysisDto)
  analysis!: RwsAnalysisDto;

  @IsDefined()
  @IsString()
  revisionReason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contractIds?: string[];
}
