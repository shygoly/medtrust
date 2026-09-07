import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P2-1:CA 证书登录——提交签名。signature 为客户端本地 SM2 私钥
// 对 challenge 的签名(十六进制),私钥不出本机。
export class CaLoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsString()
  @MinLength(3)
  account: string;

  @ApiProperty({ example: "challenge-id" })
  @IsString()
  challengeId: string;

  @ApiProperty({ example: "3045..." })
  @IsString()
  signature: string;
}
