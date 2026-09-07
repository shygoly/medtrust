import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ConnectorAdminService } from "./connector-admin.service";
import { RegisterConnectorDto } from "./dto/register-connector.dto";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../../auth/participant-roles.guard";
import { ParticipantRoles } from "../../auth/participant-role.decorator";

// 连接器注册/注销(6.2)。注册/注销仅 operator;列表对所有登录角色开放。
@ApiTags("connectors")
@ApiBearerAuth()
@Controller("connectors")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
export class ConnectorAdminController {
  constructor(private readonly admin: ConnectorAdminService) {}

  @Get()
  list() {
    return this.admin.list();
  }

  // P1-9:连接器节点真实运行状态(心跳聚合)
  @Get("status")
  status() {
    return this.admin.listRegistry();
  }

  @Post("register")
  @ParticipantRoles("operator")
  register(@Body() dto: RegisterConnectorDto) {
    return this.admin.register(dto);
  }

  @Delete(":id")
  @ParticipantRoles("operator")
  async deregister(@Param("id") connectorId: string) {
    return this.admin.deregister(connectorId);
  }
}
