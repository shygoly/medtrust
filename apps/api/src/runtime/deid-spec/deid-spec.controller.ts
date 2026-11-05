// deid-spec —— 脱敏规格的签发/版本/吊销接口（openspec/changes/connector-agent-deidentification）。
//
// 管理面：签发、查历史、吊销。
// 下发面：**不走这里** —— 规格与吊销名单随连接器长轮询批次下发
// （`ConnectorTaskBatch.deidSpecs` / `.deidRevocations`），连接器不必额外轮询。
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { DeidSpecStatus } from "@medtrust/database";
import { DeidSpecService } from "./deid-spec.service";

@ApiTags("deid-spec")
@Controller("deid/specs")
export class DeidSpecController {
  constructor(private readonly specs: DeidSpecService) {}

  @Post()
  @ApiOperation({
    summary:
      "签发脱敏规格（封闭算子 + 参数上界 + 强制字段由 schema 判定；注册中心用途密钥 SM2 签名）",
  })
  issue(
    @Body()
    body: {
      spec: unknown;
      issuedBy: string;
      validDays?: number;
    },
  ) {
    return this.specs.issue({
      spec: body.spec,
      issuedBy: body.issuedBy,
      validDays: body.validDays,
    });
  }

  @Get()
  @ApiOperation({ summary: "列出已签发规格（可按 specId / 状态过滤）" })
  list(
    @Query("specId") specId?: string,
    @Query("status") status?: DeidSpecStatus,
  ) {
    return this.specs.list({
      specId: specId?.trim() || undefined,
      status: status?.trim() ? (status.trim() as DeidSpecStatus) : undefined,
    });
  }

  @Get("active")
  @ApiOperation({ summary: "当前有效规格包（即随任务下发给连接器的那一份）" })
  active() {
    return this.specs.activePackages();
  }

  @Get("revocations")
  @ApiOperation({ summary: "吊销名单（版本 = 已吊销条数，只增不减）" })
  revocations() {
    return this.specs.revocationList();
  }

  @Get(":specId/history")
  @ApiOperation({ summary: "某规格的版本历史（含已吊销/已过期）" })
  history(@Param("specId") specId: string) {
    return this.specs.history(specId);
  }

  @Post(":specId/:version/revoke")
  @ApiOperation({ summary: "吊销一个规格版本（不可恢复；新口径请新签一版）" })
  revoke(
    @Param("specId") specId: string,
    @Param("version", ParseIntPipe) version: number,
    @Body() body: { reason: string; revokedBy: string },
  ) {
    return this.specs.revoke(
      specId,
      version,
      body.reason,
      body.revokedBy ?? "platform",
    );
  }
}
