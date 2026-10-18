import { IsString, MinLength } from "class-validator";

/** 回收访问授权：必须给原因（留痕，不做无因回收）。 */
export class RevokeDataAccessDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
