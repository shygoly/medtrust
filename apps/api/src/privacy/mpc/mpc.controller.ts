import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { MpcService } from "./mpc.service";
import {
  CreateMpcSessionDto,
  SubmitShareDto,
  MpcSessionResponseDto,
} from "./dto/mpc-session.dto";

@ApiTags("privacy/mpc")
@Controller("privacy/mpc")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MpcController {
  constructor(private readonly mpcService: MpcService) {}

  @Post("sessions")
  @ApiOperation({ summary: "Create a multi-party computation session" })
  @ApiResponse({
    status: 201,
    description: "Session created successfully",
    type: MpcSessionResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async createSession(
    @Request() req,
    @Body() dto: CreateMpcSessionDto,
  ): Promise<MpcSessionResponseDto> {
    const tenantId = req.user.tenantId;
    return this.mpcService.createSession(tenantId, dto);
  }

  @Post("sessions/:id/shares")
  @ApiOperation({ summary: "Submit secret share to MPC session" })
  @ApiResponse({
    status: 200,
    description: "Share submitted successfully",
    type: MpcSessionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request or session expired",
  })
  @ApiResponse({ status: 403, description: "Party ID mismatch" })
  @ApiResponse({ status: 404, description: "Session not found" })
  async submitShare(
    @Request() req,
    @Param("id") id: string,
    @Body() dto: SubmitShareDto,
  ): Promise<MpcSessionResponseDto> {
    const tenantId = req.user.tenantId;
    return this.mpcService.submitShare(tenantId, parseInt(id, 10), dto);
  }

  @Get("sessions/:id/result")
  @ApiOperation({ summary: "Query MPC computation result" })
  @ApiResponse({
    status: 200,
    description: "Result retrieved successfully",
    type: MpcSessionResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: "Not authorized to view this session",
  })
  @ApiResponse({ status: 404, description: "Session not found" })
  async getResult(
    @Request() req,
    @Param("id") id: string,
  ): Promise<MpcSessionResponseDto> {
    const tenantId = req.user.tenantId;
    return this.mpcService.getSession(tenantId, parseInt(id, 10));
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Cancel an MPC session" })
  @ApiResponse({ status: 204, description: "Session cancelled successfully" })
  @ApiResponse({ status: 400, description: "Cannot cancel completed session" })
  @ApiResponse({ status: 404, description: "Session not found" })
  async cancelSession(@Request() req, @Param("id") id: string): Promise<void> {
    const tenantId = req.user.tenantId;
    await this.mpcService.cancelSession(tenantId, parseInt(id, 10));
  }
}
