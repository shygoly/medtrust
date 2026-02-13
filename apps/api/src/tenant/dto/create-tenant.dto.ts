import { IsString, IsEmail, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantType } from '@medtrust/database';

export class CreateTenantDto {
  @ApiProperty({ example: 'My Hospital' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: TenantType, example: TenantType.PROVIDER })
  @IsEnum(TenantType)
  type: TenantType;

  @ApiPropertyOptional({ example: 'A leading medical institution' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'contact@hospital.com' })
  @IsEmail()
  contactEmail: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: '+86 123 4567 8900' })
  @IsOptional()
  @IsString()
  contactPhone?: string;
}
