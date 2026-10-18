import { IsString, IsOptional, IsNumber, IsEnum } from "class-validator";
// Single source of truth for AuditAction is the shared DB package. Re-export so
// existing importers of this DTO keep working.
import { AuditAction } from "@medtrust/database";
export { AuditAction };

export class CreateAuditLogDto {
  @IsEnum(AuditAction)
  action: AuditAction;

  /**
   * 资源类型。字段名沿用对外契约的 `resource`；实体的列名是 `resourceType`，
   * 由 `AuditService.create()` 负责映射（早先直接展开 DTO，TypeORM 只认实体声明过的属性，
   * 于是 `resource` 被静默丢弃、`resource_type` 恒为 null）。
   */
  @IsOptional()
  @IsString()
  resource?: string;

  /** `resource` 的别名（与实体列同名，容忍按实体字段名调用的调用方）。 */
  @IsOptional()
  @IsString()
  resourceType?: string;

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
