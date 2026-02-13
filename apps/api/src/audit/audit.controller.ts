import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditService } from './audit.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditAction } from '@medtrust/database';

@ApiTags('audit')
@Controller('audit')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post()
  @ApiOperation({ summary: '创建审计日志' })
  create(@Body() createDto: CreateAuditLogDto, @Request() req) {
    return this.auditService.create(
      req.user.userId,
      req.user.tenantId,
      createDto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get()
  @ApiOperation({ summary: '获取审计日志列表' })
  findAll(
    @Request() req,
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.findAll({
      tenantId: req.user.tenantId,
      action,
      resource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  @Get('by-user')
  @ApiOperation({ summary: '获取当前用户的审计日志' })
  findByUser(@Request() req, @Query('limit') limit?: string) {
    return this.auditService.findByUser(
      req.user.userId,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('stats')
  @ApiOperation({ summary: '获取审计统计' })
  getStats(@Request() req) {
    return this.auditService.getStats(req.user.tenantId);
  }
}
