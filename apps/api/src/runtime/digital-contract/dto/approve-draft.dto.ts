import { IsObject, IsOptional, IsString } from "class-validator";

/** 需审批预审的确认（D-CMP-2）：裁决为 manual_review 时必填 reason。 */
class PreReviewAckDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/** 医院审批 draft 申请:可选写入「固定算法模块」条款(分析类型 → 模块 SM3)；
 *  预审裁决为「需审批」时须附 preReviewAck.reason（D-CMP-2）。 */
export class ApproveDraftDto {
  @IsOptional()
  @IsObject()
  pinnedModules?: Record<string, string>;

  @IsOptional()
  @IsObject()
  preReviewAck?: PreReviewAckDto;
}
