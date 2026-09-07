import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterConnectorDto {
  @IsString()
  @IsNotEmpty()
  connectorId!: string;

  @IsString()
  @IsNotEmpty()
  participantId!: string;

  // 连接器自有 SM2 公钥;缺省则控制面代生成密钥对(演示用)。
  @IsOptional()
  @IsString()
  subjectPublicKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
