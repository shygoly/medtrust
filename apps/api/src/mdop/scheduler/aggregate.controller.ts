import { Body, Controller, Get, Param, Post, UseFilters } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { MdopErrorFilter } from "../mdop-error.filter";
import {
  AggregateSchedulerService,
  type ContributionUpload,
} from "./aggregate-scheduler.service";

/**
 * 密文路由（协议 v0.3 §7.6）。平台只收密文 blob，返回句柄；下载同样只给密文。
 */
@ApiTags("mdop")
@Controller("mdop/aggregate")
@UseFilters(MdopErrorFilter)
export class AggregateController {
  constructor(private readonly aggregates: AggregateSchedulerService) {}

  @Post("contributions")
  @ApiOperation({ summary: "上传聚合密文贡献，返回 contributionRef" })
  upload(@Body() body: ContributionUpload) {
    return this.aggregates.upload(body);
  }

  @Get("contributions/:id")
  @ApiOperation({ summary: "按句柄下载密文 blob" })
  download(@Param("id") id: string) {
    const contributionRef = id.startsWith("blob://") ? id : `blob://${id}`;
    return this.aggregates.download(contributionRef);
  }
}
