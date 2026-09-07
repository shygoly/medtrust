import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P1-2:手机验证码登录。
export class SmsLoginDto {
  @ApiProperty({ example: "13800138000" })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入正确的手机号" })
  phone: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  code: string;
}
