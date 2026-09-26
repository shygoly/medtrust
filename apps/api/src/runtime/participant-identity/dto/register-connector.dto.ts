import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterConnectorDto {
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @IsString()
  @IsNotEmpty()
  participantId!: string;

  /**
   * 连接器自有的 SM2 公钥（未压缩点 `04‖x‖y`）。
   * **必填**：参与方密钥由参与方自己生成，平台不代生成（D-MDOP-3）。
   * 用 `apps/connector/scripts/keygen.mjs` 生成后随注册请求提交。
   */
  @IsString()
  @IsNotEmpty()
  subjectPublicKey!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
