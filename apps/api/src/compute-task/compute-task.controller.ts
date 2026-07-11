import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ComputeTaskService } from "./compute-task.service";
import { CreateComputeTaskDto } from "./dto/create-compute-task.dto";
import {
  UpdateComputeTaskDto,
  UpdateTaskStatusDto,
} from "./dto/update-compute-task.dto";

@ApiTags("compute-tasks")
@Controller("compute-tasks")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ComputeTaskController {
  constructor(private readonly computeTaskService: ComputeTaskService) {}

  @Post()
  @ApiOperation({ summary: "创建计算任务" })
  create(@Body() createDto: CreateComputeTaskDto, @Request() req) {
    return this.computeTaskService.create(req.user.tenantId, createDto);
  }

  @Get()
  @ApiOperation({ summary: "获取计算任务列表" })
  findAll(
    @Query("tenantId") tenantId: string,
    @Query("requestId") requestId: string,
  ) {
    if (tenantId) {
      return this.computeTaskService.findByTenant(parseInt(tenantId));
    }
    if (requestId) {
      return this.computeTaskService.findByRequest(parseInt(requestId));
    }
    return this.computeTaskService.findAll();
  }

  @Get("stats")
  @ApiOperation({ summary: "获取计算任务统计" })
  getStats(@Request() req) {
    return this.computeTaskService.getTaskStats(req.user.tenantId);
  }

  @Get(":id")
  @ApiOperation({ summary: "获取计算任务详情" })
  findOne(@Param("id") id: string) {
    return this.computeTaskService.findOne(parseInt(id));
  }

  @Patch(":id")
  @ApiOperation({ summary: "更新计算任务" })
  update(@Param("id") id: string, @Body() updateDto: UpdateComputeTaskDto) {
    return this.computeTaskService.update(parseInt(id), updateDto);
  }

  @Patch(":id/status")
  @ApiOperation({ summary: "更新计算任务状态" })
  updateStatus(
    @Param("id") id: string,
    @Body() statusDto: UpdateTaskStatusDto,
  ) {
    return this.computeTaskService.updateStatus(parseInt(id), statusDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "删除计算任务" })
  remove(@Param("id") id: string) {
    return this.computeTaskService.remove(parseInt(id));
  }
}
