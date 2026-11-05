// deid-dictionary —— 脱敏词表的摘要背书接口（Phase 2）。
//
// 管理面：登记（医院报摘要）、查历史、吊销。
// 下发面：随连接器长轮询批次（`ConnectorTaskBatch.deidDictionaries` / `.deidDictionaryRevocations`）。
// **词表内容不上平台**：这里只收 SM3 与字节数。
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
import { DeidDictionaryService } from "./deid-dictionary.service";

@ApiTags("deid-dictionary")
@Controller("deid/dictionaries")
export class DeidDictionaryController {
  constructor(private readonly dictionaries: DeidDictionaryService) {}

  @Post()
  @ApiOperation({
    summary:
      "登记脱敏词表摘要（只收 SM3 + 字节数，不收内容；注册中心用途密钥签名）",
  })
  register(
    @Body()
    body: {
      dictionaryId: string;
      sm3: string;
      byteSize: number;
      submittedBy: string;
      approvedBy: string;
      validDays?: number;
    },
  ) {
    return this.dictionaries.register(body);
  }

  @Get()
  @ApiOperation({ summary: "列出已登记词表清单（可按 dictionaryId 过滤）" })
  list(@Query("dictionaryId") dictionaryId?: string) {
    return this.dictionaries.list({
      dictionaryId: dictionaryId?.trim() || undefined,
    });
  }

  @Get("active")
  @ApiOperation({ summary: "当前有效词表清单（即随任务下发给连接器的那一份）" })
  active() {
    return this.dictionaries.activeManifests();
  }

  @Get("revocations")
  @ApiOperation({ summary: "词表吊销名单（版本 = 已吊销条数，只增不减）" })
  revocations() {
    return this.dictionaries.revocationList();
  }

  @Post(":dictionaryId/:version/revoke")
  @ApiOperation({ summary: "吊销一个词表版本（引用它的规格随之 fail-closed）" })
  revoke(
    @Param("dictionaryId") dictionaryId: string,
    @Param("version", ParseIntPipe) version: number,
    @Body() body: { reason: string; revokedBy: string },
  ) {
    return this.dictionaries.revoke(
      dictionaryId,
      version,
      body.reason,
      body.revokedBy ?? "platform",
    );
  }
}
