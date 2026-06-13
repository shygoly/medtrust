import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
// Single source of truth for AuditAction is the shared DB package. Re-export so
// existing importers of this DTO keep working.
import { AuditAction } from '@medtrust/database';
export { AuditAction };

export class CreateAuditLogDto {
  @IsEnum(AuditAction)
  action: AuditAction;

  @IsString()
  resource: string;

  @IsOptional()
  @IsNumber()
  resourceId?: number;

  @IsOptional()
  details?: any;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}
