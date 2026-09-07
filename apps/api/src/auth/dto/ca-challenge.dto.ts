import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P2-1:CA 证书登录——获取挑战。
export class CaChallengeDto {
  @ApiProperty({ example: "user@example.com 或 13800138000" })
  @IsString()
  @MinLength(3)
  account: string;
}
