import { IsObject, IsOptional } from "class-validator";

/** 医院审批 draft 申请:可选地写入「固定算法模块」条款(分析类型 → 模块 SM3)。 */
export class ApproveDraftDto {
  @IsOptional()
  @IsObject()
  pinnedModules?: Record<string, string>;
}
