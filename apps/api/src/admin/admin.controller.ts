import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParticipantRolesGuard } from "../auth/participant-roles.guard";
import { ParticipantRoles } from "../auth/participant-role.decorator";
import { AdminService } from "./admin.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { AdminResetPasswordDto } from "./dto/admin-reset-password.dto";

// P0-11:运营方最小用户管理 API。全部端点 operator 门禁。
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(JwtAuthGuard, ParticipantRolesGuard)
@ParticipantRoles("operator")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("users")
  @ApiOperation({ summary: "用户列表(运营方)" })
  @ApiResponse({ status: 200, description: "User page" })
  async listUsers(
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.adminService.listUsers({
      search,
      role,
      status,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "更新用户(分配角色/启用禁用)" })
  @ApiResponse({ status: 200, description: "Updated user" })
  async updateUser(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Post("users/:id/reset-password")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: "重置用户密码(运营方)" })
  @ApiResponse({ status: 200, description: "Password reset" })
  async resetPassword(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.adminService.resetPassword(id, dto.newPassword);
  }
}
