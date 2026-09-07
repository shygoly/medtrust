import { IsString, Matches, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P1-7:用户 CA 身份凭证生成——客户端本地生成 SM2 密钥对,仅上报公钥;
// 平台用中心 CA 签发证书,私钥永不上传。
export class IssueUserCaDto {
  @ApiProperty({ example: "上海示例医院-管理员" })
  @IsString()
  @MaxLength(100)
  identityName: string;

  @ApiProperty({ example: "04" + "a1".repeat(64) })
  @IsString()
  @Matches(/^04[0-9a-fA-F]{128}$/, {
    message: "SM2 公钥格式不正确(应为 04 开头的 130 位十六进制)",
  })
  publicKey: string;
}
