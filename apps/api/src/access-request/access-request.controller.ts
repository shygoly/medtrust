import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AccessRequestService } from './access-request.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { UpdateAccessRequestDto } from './dto/update-access-request.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Access Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('access-requests')
export class AccessRequestController {
  constructor(private readonly accessRequestService: AccessRequestService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new access request' })
  @ApiResponse({ status: 201, description: 'Access request created successfully' })
  create(
    @Body() createDto: CreateAccessRequestDto,
    @CurrentUser('userId') userId: number,
  ) {
    // TODO: Get tenantId from user's tenant
    return this.accessRequestService.create(1, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all access requests' })
  @ApiResponse({ status: 200, description: 'List of access requests' })
  @ApiQuery({ name: 'tenantId', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: ['requester', 'provider'] })
  findAll(
    @Query('tenantId') tenantId?: number,
    @Query('type') type?: 'requester' | 'provider',
  ) {
    return this.accessRequestService.findAll(tenantId, type);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an access request by ID' })
  @ApiResponse({ status: 200, description: 'Access request found' })
  @ApiResponse({ status: 404, description: 'Access request not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.accessRequestService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an access request' })
  @ApiResponse({ status: 200, description: 'Access request updated' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateAccessRequestDto,
  ) {
    return this.accessRequestService.update(id, updateDto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve an access request' })
  @ApiResponse({ status: 200, description: 'Access request approved' })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('userId') userId: number,
  ) {
    return this.accessRequestService.approve(id, userId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an access request' })
  @ApiResponse({ status: 200, description: 'Access request rejected' })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body('rejectionReason') rejectionReason: string,
  ) {
    return this.accessRequestService.reject(id, rejectionReason);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete an access request' })
  @ApiResponse({ status: 200, description: 'Access request completed' })
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body('actualCost') actualCost: number,
  ) {
    return this.accessRequestService.complete(id, actualCost);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an access request' })
  @ApiResponse({ status: 200, description: 'Access request deleted' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.accessRequestService.remove(id);
  }
}
