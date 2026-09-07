import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P1-2:发送手机登录验证码。仅支持中国大陆手机号。
export class SendSmsCodeDto {
  @ApiProperty({ example: "13800138000" })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: "请输入正确的手机号" })
  phone: string;
}
