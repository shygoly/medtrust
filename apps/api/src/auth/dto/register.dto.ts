import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_MESSAGE,
} from "../password-policy";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  // P0-5:至少 8 位,且包含大写字母、小写字母、数字、特殊字符中的至少三类。
  @ApiProperty({ example: "Abc12345!" })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  password: string;

  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @IsString()
  name?: string;
}
