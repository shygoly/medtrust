import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Delete,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { FederatedLearningService } from './fl.service';
import { CreateFLJobDto, FLJobResponseDto } from './dto/fl-job.dto';

@ApiTags('privacy/federated-learning')
@Controller('privacy/fl')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FederatedLearningController {
  constructor(private readonly flService: FederatedLearningService) {}

  @Post('jobs')
  @ApiOperation({ summary: 'Submit a federated learning job' })
  @ApiResponse({ status: 201, description: 'Job created successfully', type: FLJobResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createJob(
    @Request() req,
    @Body() dto: CreateFLJobDto,
  ): Promise<FLJobResponseDto> {
    const tenantId = req.user.tenantId;
    return this.flService.createJob(tenantId, dto);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Get all federated learning jobs for tenant' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully', type: [FLJobResponseDto] })
  async getJobs(@Request() req): Promise<FLJobResponseDto[]> {
    const tenantId = req.user.tenantId;
    return this.flService.getJobsByTenant(tenantId);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get federated learning job status' })
  @ApiResponse({ status: 200, description: 'Job status retrieved', type: FLJobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJob(
    @Request() req,
    @Param('id') id: string,
  ): Promise<FLJobResponseDto> {
    const tenantId = req.user.tenantId;
    return this.flService.getJob(tenantId, parseInt(id, 10));
  }

  @Get('jobs/:id/model')
  @ApiOperation({ summary: 'Download trained federated learning model' })
  @ApiResponse({ status: 200, description: 'Model downloaded successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 409, description: 'Model not ready' })
  @Header('Content-Type', 'application/octet-stream')
  @Header('Content-Disposition', 'attachment; filename="model.fate"')
  async downloadModel(
    @Request() req,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const tenantId = req.user.tenantId;
    const buffer = await this.flService.downloadModel(tenantId, parseInt(id, 10));
    return new StreamableFile(buffer);
  }

  @Delete('jobs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a federated learning job' })
  @ApiResponse({ status: 204, description: 'Job cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 400, description: 'Cannot cancel job in current status' })
  async cancelJob(
    @Request() req,
    @Param('id') id: string,
  ): Promise<void> {
    const tenantId = req.user.tenantId;
    await this.flService.cancelJob(tenantId, parseInt(id, 10));
  }
}
