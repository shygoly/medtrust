import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateSpaceDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
