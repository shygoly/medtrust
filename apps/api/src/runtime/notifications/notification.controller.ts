import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NotificationService } from "./notification.service";

interface RequestUser {
  participantId?: string;
}

/**
 * 站内信（D-NOTIF-1）：机构待办的收件箱。
 *
 * 只按**调用者自己的参与方**收发——没有"读别人的通知"这条路（越权 = 404）。
 */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: "我的站内信（默认全部；status=unread 只看未读）" })
  list(
    @CurrentUser() me: RequestUser,
    @Query("status") status?: "unread" | "read",
    @Query("limit") limit?: string,
  ) {
    return this.notifications.list({
      recipientParticipantId: me?.participantId ?? "",
      ...(status ? { status } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Get("unread-count")
  @ApiOperation({ summary: "未读数（工作台/角标用）" })
  async unreadCount(@CurrentUser() me: RequestUser) {
    return {
      unread: await this.notifications.unreadCount(me?.participantId ?? ""),
    };
  }

  @Post(":id/read")
  @ApiOperation({ summary: "标记一条为已读（只能标记发给自己的）" })
  markRead(@Param("id") id: string, @CurrentUser() me: RequestUser) {
    return this.notifications.markRead(id, me?.participantId ?? "");
  }

  @Post("read-all")
  @ApiOperation({ summary: "全部标记已读（仅自己参与方的未读）" })
  markAllRead(@CurrentUser() me: RequestUser) {
    return this.notifications.markAllRead(me?.participantId ?? "");
  }
}
