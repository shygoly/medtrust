import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ConnectorEnrollmentService } from "./connector-enrollment.service";

@ApiTags("connector-enrollments")
@Controller("connectors")
export class ConnectorEnrollmentController {
  constructor(private readonly enrollments: ConnectorEnrollmentService) {}

  /** 连接器提交入网申请。身份由公钥验签证明，不使用运营方 JWT。 */
  @Post("enrollments")
  submit(
    @Body()
    body: {
      connectorId?: string;
      participantId?: string;
      subjectPublicKey?: string;
      timestamp?: string;
      signature?: string;
    },
  ) {
    return this.enrollments.submit({
      connectorId: body.connectorId ?? "",
      participantId: body.participantId ?? "",
      subjectPublicKey: body.subjectPublicKey ?? "",
      timestamp: body.timestamp ?? "",
      signature: body.signature ?? "",
    });
  }

  @Get("enrollments")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  async list(@Query("status") status?: string) {
    const rows = await this.enrollments.list(status);
    return rows.map(({ pollToken: _pollToken, ...rest }) => rest);
  }

  @Get("enrollments/:id")
  poll(
    @Param("id") id: string,
    @Headers("x-enrollment-poll-token") pollToken?: string,
  ) {
    return this.enrollments.poll(id, pollToken ?? "");
  }

  @Post("enrollments/:id/approve")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  approve(@Param("id") id: string) {
    return this.enrollments.approve(id);
  }

  @Post("enrollments/:id/reject")
  @UseGuards(JwtAuthGuard, ParticipantRolesGuard)
  @ParticipantRoles("operator")
  reject(@Param("id") id: string, @Body("reason") reason?: string) {
    return this.enrollments.reject(id, reason ?? "");
  }
}
