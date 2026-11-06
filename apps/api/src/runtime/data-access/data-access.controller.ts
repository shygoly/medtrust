import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { DataAccessService, type AccessActor } from "./data-access.service";
import { GrantDataAccessDto } from "./dto/grant-data-access.dto";
import { RevokeDataAccessDto } from "./dto/revoke-data-access.dto";
import {
  ApproveAccessRequestDto,
  CreateAccessRequestDto,
  RejectAccessRequestDto,
} from "./dto/access-request.dto";

/** JWT 里与本域相关的字段（其余不取，避免顺手把身份数据带进日志/审计）。 */
interface RequestUser {
  userId?: number | string;
  tenantId?: number;
  participantId?: string;
  role?: string;
  email?: string;
}

@ApiTags("data-access")
@ApiBearerAuth()
@Controller("data-access")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class DataAccessController {
  constructor(private readonly access: DataAccessService) {}

  /**
   * 授权判定：**给 agent 与其它调用方的唯一问法**。
   *
   * 任意已认证参与方都能问（问的是"我/某人能不能访问这个产品"），返回 allowed + 原因。
   */
  @Get("check")
  @ApiOperation({
    summary: "检查某参与方是否被授权访问某数据产品（产品级 ACL）",
  })
  check(
    @Query("dataProductId") dataProductId: string,
    @Query("participantId") participantId?: string,
    @Query("permission") permission?: "catalog" | "compute",
    @Query("purpose") purpose?: string,
    @CurrentUser() me?: RequestUser,
  ) {
    return this.access.check({
      dataProductId,
      // 缺省问的是"我自己"
      participantId: participantId?.trim() || me?.participantId || "",
      ...(permission ? { permission } : {}),
      ...(purpose ? { purpose } : {}),
    });
  }

  @Get("grants")
  @ApiOperation({
    summary: "访问授权清单（合规/运营看全量；其余人只看与自己相关的行）",
  })
  list(
    @CurrentUser() me: RequestUser,
    @Query("dataProductId") dataProductId?: string,
    @Query("granteeParticipantId") granteeParticipantId?: string,
    @Query("status") status?: "active" | "revoked",
  ) {
    return this.access.list({
      actor: actorOf(me),
      ...(dataProductId ? { dataProductId } : {}),
      ...(granteeParticipantId ? { granteeParticipantId } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Post("grants")
  @ParticipantRoles("provider", "compliance", "operator")
  @ApiOperation({ summary: "授予访问权（只有产品提供方或合规/运营方可授予）" })
  grant(@Body() dto: GrantDataAccessDto, @CurrentUser() me: RequestUser) {
    return this.access.grant(dto, actorOf(me));
  }

  // ── 访问申请（使用方发起 → 提供方批准） ─────────────────────────────────

  /** 使用方申请访问某数据产品（幂等：已有待处理申请直接返回那一条）。 */
  @Post("requests")
  @ParticipantRoles("consumer")
  @ApiOperation({ summary: "申请访问某个数据产品（提供方批准后才生效）" })
  requestAccess(
    @Body() dto: CreateAccessRequestDto,
    @CurrentUser() me: RequestUser,
  ) {
    return this.access.requestAccess(dto, actorOf(me));
  }

  /** 申请清单：特权角色看全部；提供方看「待我批 + 我发起的」；使用方只看自己。 */
  @Get("requests")
  @ApiOperation({ summary: "访问申请清单（按角色自动收窄）" })
  listRequests(
    @CurrentUser() me: RequestUser,
    @Query("status") status?: "pending" | "approved" | "rejected" | "withdrawn",
  ) {
    return this.access.listRequests({ ...(status ? { status } : {}) }, actorOf(me));
  }

  /** 批准申请：落授权行（走既有 grant，含审计）并把申请置 approved。 */
  @Post("requests/:id/approve")
  @ParticipantRoles("provider", "compliance", "operator")
  @ApiOperation({ summary: "批准访问申请（生成授权行）" })
  approveRequest(
    @Param("id") id: string,
    @Body() dto: ApproveAccessRequestDto,
    @CurrentUser() me: RequestUser,
  ) {
    return this.access.approveRequest(id, actorOf(me), dto ?? {});
  }

  /** 驳回申请（必须写原因）。 */
  @Post("requests/:id/reject")
  @ParticipantRoles("provider", "compliance", "operator")
  @ApiOperation({ summary: "驳回访问申请（必须给原因）" })
  rejectRequest(
    @Param("id") id: string,
    @Body() dto: RejectAccessRequestDto,
    @CurrentUser() me: RequestUser,
  ) {
    return this.access.rejectRequest(id, dto.reason, actorOf(me));
  }

  /** 申请方撤回待处理申请。 */
  @Post("requests/:id/withdraw")
  @ParticipantRoles("consumer")
  @ApiOperation({ summary: "撤回自己发起的待处理申请" })
  withdrawRequest(@Param("id") id: string, @CurrentUser() me: RequestUser) {
    return this.access.withdrawRequest(id, actorOf(me));
  }

  @Post("grants/:id/revoke")
  @ParticipantRoles("provider", "compliance", "operator")
  @ApiOperation({ summary: "回收访问权（必须给原因；回收是追加式的，不删行）" })
  revoke(
    @Param("id") id: string,
    @Body() dto: RevokeDataAccessDto,
    @CurrentUser() me: RequestUser,
  ) {
    return this.access.revoke(id, dto.reason, actorOf(me));
  }
}

const actorOf = (me?: RequestUser): AccessActor => ({
  userId: me?.userId ?? null,
  tenantId: me?.tenantId ?? null,
  participantId: me?.participantId ?? null,
  role: me?.role ?? null,
  email: me?.email ?? null,
});
