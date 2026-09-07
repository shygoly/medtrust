import { IsString, Matches, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PASSWORD_POLICY_REGEX, PASSWORD_POLICY_MESSAGE } from "../password-policy";

// P1-8:手机验证码重置密码。
export class SmsResetPasswordDto {
  @ApiProperty({ example: "13800138000" })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入正确的手机号" })
  phone: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  code: string;

  @ApiProperty({ example: "Abc12345!" })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}
