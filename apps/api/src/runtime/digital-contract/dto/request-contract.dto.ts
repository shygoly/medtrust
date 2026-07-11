import { IsInt, IsString, Min } from "class-validator";

/** 药企（consumer）发起数字合约申请 */
export class RequestContractDto {
  @IsString()
  dataProductId!: string;

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
