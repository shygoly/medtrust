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
import type {
  ListingConsent,
  ProductProvenance,
  ServiceSpec,
} from "@medtrust/database";

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

  /** ndi-catalog-upstream-listing：缺省 internal，不自动对外上报。 */
  @IsOptional()
  @IsIn(["internal", "regional"])
  listingScope?: "internal" | "regional";

  /** 公开授权留痕（转 regional 前必填）。 */
  @IsOptional()
  @IsObject()
  listingConsent?: ListingConsent | null;

  /** 数据服务规格（productType=service 时必填）。 */
  @IsOptional()
  @IsObject()
  serviceSpec?: ServiceSpec | null;

  /** 服务容量/历史任务数（服务类不用 recordCount 表达规模）。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  serviceCapacity?: number | null;

  /** 参与方披露：默认只给数量区间。 */
  @IsOptional()
  @IsObject()
  provenance?: ProductProvenance | null;

  /** Connector-local path where raw data resides (metadata only; rows never leave domain). */
  @IsOptional()
  @IsString()
  dataPath?: string;
}
