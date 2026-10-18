import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ClassificationTagDto {
  @IsIn(["1", "2", "3", "4"])
  level!: string;

  @IsString()
  categoryCode!: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class PublishDataProductDto {
  @IsString()
  providerId!: string;

  @IsString()
  title!: string;

  // data=数据产品 / service=数据服务(P0-2);缺省按 data。
  @IsOptional()
  @IsIn(["data", "service"])
  productType?: "data" | "service";

  // 确权 / 分级分类在 service 中强制(返回领域错误信息)
  @IsOptional()
  @IsString()
  classification?: string;

  // P1-8:NDI-TR-2025-06 结构化分级标签(级别+类别编码+标签版本)
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClassificationTagDto)
  classificationTag?: ClassificationTagDto;

  @IsBoolean()
  rightsConfirmed!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  recordCount?: number;

  @IsOptional()
  @IsObject()
  fhirSchema?: Record<string, unknown>;

  @IsOptional()
  @IsString({ each: true })
  productRoles?: string[];

  /** Connector-local path where raw data resides (metadata only; rows never leave domain). */
  @IsOptional()
  @IsString()
  dataPath?: string;
}
