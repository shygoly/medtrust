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
import { DataAssetService } from './data-asset.service';
import { CreateDataAssetDto } from './dto/create-data-asset.dto';
import { UpdateDataAssetDto } from './dto/update-data-asset.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Data Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('data-assets')
export class DataAssetController {
  constructor(private readonly dataAssetService: DataAssetService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new data asset' })
  @ApiResponse({ status: 201, description: 'Data asset created successfully' })
  create(
    @Body() createDataAssetDto: CreateDataAssetDto,
    @CurrentUser('userId') userId: number,
  ) {
    // TODO: Get tenantId from user's tenant
    return this.dataAssetService.create(1, createDataAssetDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all data assets' })
  @ApiResponse({ status: 200, description: 'List of data assets' })
  @ApiQuery({ name: 'tenantId', required: false, type: Number })
  findAll(@Query('tenantId') tenantId?: number) {
    return this.dataAssetService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a data asset by ID' })
  @ApiResponse({ status: 200, description: 'Data asset found' })
  @ApiResponse({ status: 404, description: 'Data asset not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.dataAssetService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a data asset' })
  @ApiResponse({ status: 200, description: 'Data asset updated' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDataAssetDto: UpdateDataAssetDto,
  ) {
    return this.dataAssetService.update(id, updateDataAssetDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a data asset' })
  @ApiResponse({ status: 200, description: 'Data asset deleted' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.dataAssetService.remove(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a data asset' })
  @ApiResponse({ status: 200, description: 'Data asset published' })
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.dataAssetService.publish(id);
  }
}
