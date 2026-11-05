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
import { ClassificationTagDto } from "./publish-data-product.dto";
import type {
  ListingConsent,
  ProductProvenance,
  ServiceSpec,
} from "@medtrust/database";

export class UpdateDataProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(["data", "service"])
  productType?: "data" | "service";

  @IsOptional()
  @IsString()
  classification?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClassificationTagDto)
  classificationTag?: ClassificationTagDto;

  @IsOptional()
  @IsBoolean()
  rightsConfirmed?: boolean;

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
}
