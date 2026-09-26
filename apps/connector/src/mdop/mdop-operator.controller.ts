import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MdopOperatorWhitelistStore } from './operator-whitelist';
import { LocalAdminGuard } from './local-admin.guard';

/**
 * 算子白名单的**院内**管理入口（D-MDOP-5 / 任务 6.3）。
 *
 * 白名单只能由医院在本地按摘要加/减；平台 MUST NOT 有远程修改的途径 ——
 * 这条由代码结构保证：整仓只有本控制器与 CLI 会写 `local_mdop_operator_whitelist`，
 * 消息处理路径（批次/信封）只写清单与吊销状态。
 */
@Controller('connector/mdop/operators')
@UseGuards(LocalAdminGuard)
export class MdopOperatorController {
  constructor(private readonly store: MdopOperatorWhitelistStore) {}

  @Get()
  async list() {
    return {
      whitelist: await this.store.list(),
      // 清单来自平台（注册中心密钥签），与白名单是两回事
      manifestsLoaded: this.store.manifestCount(),
      revoked: await this.store.revokedDigests(),
      revocationSynced: await this.store.hasValidRevocationList(),
    };
  }

  @Post()
  async add(
    @Body() body: { digest?: string; kind?: 'wasm' | 'system'; note?: string },
    @Req() req: { localAdminActor: string },
  ) {
    if (!body.digest) throw new Error('缺少 digest');
    return this.store.add(body.digest, req.localAdminActor, {
      ...(body.kind ? { kind: body.kind } : {}),
      ...(body.note ? { note: body.note } : {}),
    });
  }

  @Delete(':digest')
  async remove(@Param('digest') digest: string) {
    await this.store.remove(digest);
    return { digest, removed: true };
  }
}
