import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P2-4:MFA 绑定/禁用共用的 6 位 TOTP 验证码。
export class MfaCodeDto {
  @ApiProperty({ example: "123456" })
  @IsString()
  @Matches(/^\d{6}$/, { message: "请输入 6 位数字验证码" })
  code: string;
}
