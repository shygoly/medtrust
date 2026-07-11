import { IsInt, IsString, Min } from "class-validator";

export class ApproveContractDto {
  @IsString()
  dataProductId!: string;

  @IsString()
  providerId!: string;

  @IsString()
  consumerId!: string;

  @IsString()
  purpose!: string;

  @IsString()
  retention!: string;

  @IsString()
  output!: string;

  @IsInt()
  @Min(1)
  validDays!: number;
}
