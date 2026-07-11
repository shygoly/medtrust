import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class PublishDataProductDto {
  @IsString()
  providerId!: string;

  @IsString()
  title!: string;

  // 确权 / 分级分类在 service 中强制(返回领域错误信息)
  @IsOptional()
  @IsString()
  classification?: string;

  @IsBoolean()
  rightsConfirmed!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  recordCount?: number;

  @IsOptional()
  @IsObject()
  fhirSchema?: Record<string, unknown>;

  /** Connector-local path where raw data resides (metadata only; rows never leave domain). */
  @IsOptional()
  @IsString()
  dataPath?: string;
}
