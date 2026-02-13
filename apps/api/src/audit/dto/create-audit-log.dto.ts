import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';

export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  COMPUTE = 'COMPUTE',
  DOWNLOAD = 'DOWNLOAD',
}

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
