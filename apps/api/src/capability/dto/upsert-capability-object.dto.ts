import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

// 七层系统对象(L1/L3-L7)的通用增改 DTO。字段为各层并集,多数 optional;
// 必填由 CapabilityRegistryService 按 layer 校验(全局 ValidationPipe whitelist
// 会剥离未声明字段,故这里需声明所有允许字段)。
export class UpsertCapabilityObjectDto {
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsIn(["active", "deprecated", "draft"]) status?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsString() basedOn?: string;

  // L1
  @IsOptional() @IsIn(["low", "medium", "high"]) riskLevel?: string;
  @IsOptional() @IsString() criteria?: string;
  @IsOptional() @IsArray() typicalModelKeys?: string[];
  @IsOptional() @IsArray() typicalAlgorithmKeys?: string[];

  // L3 / L4
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() trainingAlgorithmKeys?: string[];
  @IsOptional() @IsString() complianceNote?: string;
  @IsOptional() @IsArray() underlyingOperatorKeys?: string[];
  @IsOptional() @IsArray() compliancePrivacyModels?: string[];

  // L5
  @IsOptional() @IsString() opType?: string;
  @IsOptional() @IsArray() supportedProtocolKeys?: string[];
  @IsOptional() @IsBoolean() complianceDriven?: boolean;
  @IsOptional() @IsString() triggeredBy?: string;

  // L6
  @IsOptional() @IsString() family?: string;
  @IsOptional() @IsString() securityAssumption?: string;
  @IsOptional() @IsIn(["basic", "enhanced"]) securityCapabilityLevel?: string;
  @IsOptional() @IsString() handlerKey?: string;

  // L7
  @IsOptional() @IsString() infraType?: string;
  @IsOptional() @IsString() vendor?: string;
}
