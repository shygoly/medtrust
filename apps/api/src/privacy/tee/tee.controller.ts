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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TeeService } from "./tee.service";
import {
  CreateTeeComputationDto,
  TeeComputationResponseDto,
  AttestationResponseDto,
} from "./dto/tee-computation.dto";

@ApiTags("privacy/tee")
@Controller("privacy/tee")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TeeController {
  constructor(private readonly teeService: TeeService) {}

  @Post("computations")
  @ApiOperation({
    summary:
      "创建历史 TEE 通道计算记录（证明走 mdop 契约；默认未注入信任根，不得表述为已具备远程证明）",
  })
  @ApiResponse({
    status: 201,
    description: "Computation created successfully",
    type: TeeComputationResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async createComputation(
    @Request() req,
    @Body() dto: CreateTeeComputationDto,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.createComputation(tenantId, dto);
  }

  @Get("computations/:id")
  @ApiOperation({
    summary:
      "查询历史 TEE 通道计算状态（未注入信任根时 attestation_valid 为 false）",
  })
  @ApiResponse({
    status: 200,
    description: "Computation status retrieved",
    type: TeeComputationResponseDto,
  })
  @ApiResponse({ status: 404, description: "Computation not found" })
  async getComputation(
    @Request() req,
    @Param("id") id: string,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.getComputation(tenantId, parseInt(id, 10));
  }

  @Get("computations/:id/attestation")
  @ApiOperation({
    summary:
      "取证明报告（校验走 mdop verifyAttestationForC2；默认未注入信任根，verified 为 false）",
  })
  @ApiResponse({
    status: 200,
    description:
      "返回 mdop AttestationReport；未注入 TrustedRoot 时 verified 为 false",
    type: AttestationResponseDto,
  })
  @ApiResponse({ status: 400, description: "Instance not yet provisioned" })
  @ApiResponse({ status: 404, description: "Computation not found" })
  async getAttestation(
    @Request() req,
    @Param("id") id: string,
  ): Promise<AttestationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.getAttestation(tenantId, parseInt(id, 10));
  }

  @Post("computations/:id/submit")
  @UseInterceptors(FileInterceptor("data"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "提交加密数据（attestation 未通过 mdop 校验则拒绝）",
  })
  @ApiResponse({
    status: 200,
    description: "Computation submitted successfully",
    type: TeeComputationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid request or attestation not verified",
  })
  @ApiResponse({ status: 404, description: "Computation not found" })
  async submitComputation(
    @Request() req,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.submitComputation(
      tenantId,
      parseInt(id, 10),
      file.buffer,
    );
  }

  @Delete("computations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "终止 TEE 通道计算并回收占位实例" })
  @ApiResponse({
    status: 204,
    description: "Computation terminated successfully",
  })
  @ApiResponse({ status: 404, description: "Computation not found" })
  async terminateComputation(
    @Request() req,
    @Param("id") id: string,
  ): Promise<void> {
    const tenantId = req.user.tenantId;
    await this.teeService.terminateComputation(tenantId, parseInt(id, 10));
  }
}
