import { IsOptional, IsString, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class LoginDto {
  // L-3:账号不限于邮箱——支持邮箱或已绑定手机号。
  @ApiProperty({ example: "user@example.com 或 13800138000" })
  @IsString()
  @MinLength(3)
  account: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @MinLength(6)
  password: string;

  // P0-3:图形验证码。账号密码登录由 AuthController 强制校验;
  // 此处保持可选,便于 sso/ticket 等非口令流程复用 DTO 校验管线。
  @ApiPropertyOptional({ example: "captcha-uuid" })
  @IsOptional()
  @IsString()
  captchaId?: string;

  @ApiPropertyOptional({ example: "AB3D" })
  @IsOptional()
  @IsString()
  captchaCode?: string;

  // P2-4:启用 MFA 的账号登录时必填(6 位 TOTP)。
  @ApiPropertyOptional({ example: "123456" })
  @IsOptional()
  @IsString()
  mfaCode?: string;
}
