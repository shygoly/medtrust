import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

// P1-4:机构认证三步流程的保存/提交 DTO。草稿与提交共用;
// submit=true 时进入 submitted 待审核状态。
export class SaveCertificationDto {
  @ApiPropertyOptional({ example: "企事业单位法人" })
  @IsOptional()
  @IsString()
  orgType?: string;

  @ApiPropertyOptional({ example: ["cert/license/xx.jpg"] })
  @IsOptional()
  @IsArray()
  licenseImages?: string[];

  @ApiPropertyOptional({ example: "上海示例医院" })
  @IsOptional()
  @IsString()
  orgName?: string;

  @ApiPropertyOptional({ example: "91310000XXXXXXXXXX" })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-HJ-NPQRTUWXY]{18}$/, {
    message: "统一社会信用代码应为 18 位数字或大写字母",
  })
  uscc?: string;

  @ApiPropertyOptional({ example: "long-term", enum: ["long-term", "custom"] })
  @IsOptional()
  @IsIn(["long-term", "custom"])
  validPeriod?: "long-term" | "custom";

  @ApiPropertyOptional({ example: "2035-12-31" })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional({ example: "上海市/黄浦区" })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: "黄浦区示例路 1 号" })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: "医疗服务;医学研究" })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: "经营范围最多 1000 字" })
  businessScope?: string;

  @ApiPropertyOptional({ example: "三级甲等综合医院" })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: "机构简介最多 2000 字" })
  orgIntro?: string;

  @ApiPropertyOptional({ example: "医疗卫生" })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  @IsNumber()
  capitalWanYuan?: number;

  @ApiPropertyOptional({ example: "2010-05-20" })
  @IsOptional()
  @IsString()
  regDate?: string;

  @ApiPropertyOptional({ example: "cert/logo/xx.png" })
  @IsOptional()
  @IsString()
  logoKey?: string;

  @ApiPropertyOptional({ example: "上海示例医院-管理员" })
  @IsOptional()
  @IsString()
  caIdentityName?: string;

  @ApiPropertyOptional({ example: "04..." })
  @IsOptional()
  @IsString()
  caPublicKey?: string;

  @ApiPropertyOptional({ example: "SM2:ABCD1234" })
  @IsOptional()
  @IsString()
  caCertFingerprint?: string;

  @ApiPropertyOptional({ example: false, description: "true=提交审核" })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
