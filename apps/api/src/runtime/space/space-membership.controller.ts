import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { SpaceMembershipService } from "./space-membership.service";
import { CollaborationService } from "./collaboration.service";
import type { SpaceSubjectType } from "@medtrust/database";

/**
 * 空间成员与入域（P6 / D-SPD-14）。
 * 邀请、成员直加、邀请撤销限 `operator`（空间不可自审，D-SPD-9）；
 * 接受邀请由被邀请人自己完成，且接受者主体 MUST 与登录主体一致。
 */
@ApiTags("space-membership")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class SpaceMembershipController {
  constructor(
    private readonly membership: SpaceMembershipService,
    private readonly collaborations: CollaborationService,
  ) {}

  @Get(":spaceId/members")
  async listMembers(
    @Param("spaceId") spaceId: string,
    @Request()
    req: { user?: { participantId?: string; userId?: number | string } },
  ) {
    const members = await this.membership.listMembers(spaceId);
    const subject =
      (typeof req?.user?.participantId === "string" &&
        req.user.participantId.trim()) ||
      (req?.user?.userId != null ? String(req.user.userId) : "");
    const hidden = await this.collaborations.hiddenParticipantIds(
      spaceId,
      subject,
    );
    return members.filter((member) => !hidden.has(member.subjectId));
  }

  @Post(":spaceId/members")
  @ParticipantRoles("operator")
  addMember(
    @Param("spaceId") spaceId: string,
    @Body()
    body: { subjectType: SpaceSubjectType; subjectId: string; role: string },
    @Request() req: any,
  ) {
    return this.membership.addMember({
      spaceId,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      role: body.role,
      invitedBy: req?.user?.email,
    });
  }

  @Get(":spaceId/invitations")
  @ParticipantRoles("operator")
  listInvitations(@Param("spaceId") spaceId: string) {
    return this.membership.listInvitations(spaceId);
  }

  @Post(":spaceId/invitations")
  @ParticipantRoles("operator")
  invite(
    @Param("spaceId") spaceId: string,
    @Body()
    body: {
      subjectType: SpaceSubjectType;
      invitee: string;
      role: string;
      ttlMs?: number;
    },
    @Request() req: any,
  ) {
    return this.membership.invite({
      spaceId,
      subjectType: body.subjectType,
      invitee: body.invitee,
      role: body.role,
      ttlMs: body.ttlMs,
      invitedBy: req?.user?.email,
    });
  }

  @Delete(":spaceId/invitations/:id")
  @ParticipantRoles("operator")
  async revokeInvitation(
    @Param("spaceId") spaceId: string,
    @Param("id") id: string,
  ) {
    await this.membership.revokeInvitation(spaceId, id);
    return { revoked: true };
  }

  @Post("invitations/accept")
  async accept(
    @Body() body: { token: string; subjectType: SpaceSubjectType },
    @Request() req: any,
  ) {
    // 接受者主体取自**登录态**，不接受请求体自报，防止邀请被转发使用。
    const user = req?.user ?? {};
    const subjectId =
      body.subjectType === "user"
        ? String(user.userId ?? "")
        : String(user.participantId ?? "");
    if (!subjectId) throw new ForbiddenException("登录主体缺少对应主体标识");
    return this.membership.acceptInvitation(body.token, {
      subjectType: body.subjectType,
      subjectId,
    });
  }
}
