import { IsString, Matches, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_MESSAGE,
} from "../../auth/password-policy";

// P0-11:运营重置用户密码(需符合统一密码策略)。
export class AdminResetPasswordDto {
  @ApiProperty({ example: "Abc12345!" })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  newPassword: string;
}
