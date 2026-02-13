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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TeeService } from './tee.service';
import { CreateTeeComputationDto, TeeComputationResponseDto, AttestationResponseDto } from './dto/tee-computation.dto';

@ApiTags('privacy/tee')
@Controller('privacy/tee')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TeeController {
  constructor(private readonly teeService: TeeService) {}

  @Post('computations')
  @ApiOperation({ summary: 'Create a TEE computation and provision SGX instance' })
  @ApiResponse({ status: 201, description: 'Computation created successfully', type: TeeComputationResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createComputation(
    @Request() req,
    @Body() dto: CreateTeeComputationDto,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.createComputation(tenantId, dto);
  }

  @Get('computations/:id')
  @ApiOperation({ summary: 'Get TEE computation status' })
  @ApiResponse({ status: 200, description: 'Computation status retrieved', type: TeeComputationResponseDto })
  @ApiResponse({ status: 404, description: 'Computation not found' })
  async getComputation(
    @Request() req,
    @Param('id') id: string,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.getComputation(tenantId, parseInt(id, 10));
  }

  @Get('computations/:id/attestation')
  @ApiOperation({ summary: 'Get SGX remote attestation report' })
  @ApiResponse({ status: 200, description: 'Attestation report retrieved', type: AttestationResponseDto })
  @ApiResponse({ status: 400, description: 'Instance not yet provisioned' })
  @ApiResponse({ status: 404, description: 'Computation not found' })
  async getAttestation(
    @Request() req,
    @Param('id') id: string,
  ): Promise<AttestationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.getAttestation(tenantId, parseInt(id, 10));
  }

  @Post('computations/:id/submit')
  @UseInterceptors(FileInterceptor('data'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit encrypted data for TEE computation' })
  @ApiResponse({ status: 200, description: 'Computation submitted successfully', type: TeeComputationResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request or attestation not verified' })
  @ApiResponse({ status: 404, description: 'Computation not found' })
  async submitComputation(
    @Request() req,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<TeeComputationResponseDto> {
    const tenantId = req.user.tenantId;
    return this.teeService.submitComputation(tenantId, parseInt(id, 10), file.buffer);
  }

  @Delete('computations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminate TEE computation and SGX instance' })
  @ApiResponse({ status: 204, description: 'Computation terminated successfully' })
  @ApiResponse({ status: 404, description: 'Computation not found' })
  async terminateComputation(
    @Request() req,
    @Param('id') id: string,
  ): Promise<void> {
    const tenantId = req.user.tenantId;
    await this.teeService.terminateComputation(tenantId, parseInt(id, 10));
  }
}
