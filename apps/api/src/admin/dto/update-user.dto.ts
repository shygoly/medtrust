import { IsIn, IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { ParticipantRole } from "@medtrust/database";

// P0-11:运营方最小用户管理。字段全部可选,只更新显式传入项。
export class UpdateUserDto {
  @ApiPropertyOptional({ example: "张三" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: "p-huashan" })
  @IsOptional()
  @IsString()
  participantId?: string;

  @ApiPropertyOptional({
    example: "provider",
    enum: ["provider", "consumer", "operator", "compliance", "admin"],
  })
  @IsOptional()
  @IsIn(["provider", "consumer", "operator", "compliance", "admin"])
  participantRole?: ParticipantRole;

  @ApiPropertyOptional({
    example: "active",
    enum: ["active", "disabled", "pending"],
  })
  @IsOptional()
  @IsIn(["active", "disabled", "pending"])
  status?: "active" | "disabled" | "pending";
}
