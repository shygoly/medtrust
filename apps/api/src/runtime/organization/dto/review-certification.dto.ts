import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// P1-4:运营方审核机构认证申请。
export class ReviewCertificationDto {
  @ApiProperty({ example: true, description: "true=通过,false=驳回" })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ example: "证照模糊,请重新上传" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
