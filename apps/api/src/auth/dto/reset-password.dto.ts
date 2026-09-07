import { IsEmail, IsString, MinLength, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_MESSAGE,
} from "../password-policy";

export class ResetPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  code: string;

  @ApiProperty({ example: "Abc12345!" })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  newPassword: string;
}
