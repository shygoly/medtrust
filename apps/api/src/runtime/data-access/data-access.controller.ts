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

/** JWT 里与本域相关的字段（其余不取，避免顺手把身份数据带进日志/审计）。 */
interface RequestUser {
  userId?: number | string;
  tenantId?: number;
  participantId?: string;
  role?: string;
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
});
