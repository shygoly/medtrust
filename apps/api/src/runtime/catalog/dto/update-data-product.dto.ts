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
}
