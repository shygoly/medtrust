import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/** P2-5：切换当前空间。 */
export class SwitchSpaceDto {
  @ApiProperty({ description: "目标空间 id（须为本用户已属空间）" })
  @IsString()
  @IsNotEmpty()
  spaceId!: string;
}
