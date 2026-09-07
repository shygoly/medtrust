import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateAppDto {
  @ApiProperty({ example: "西安节点数据同步" })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: ["catalog:read", "audit:report"] })
  @IsOptional()
  @IsArray()
  scopes?: string[];
}
