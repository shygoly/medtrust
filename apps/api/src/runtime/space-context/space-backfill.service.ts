import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { SPACE_SCOPED_TABLES } from "@medtrust/database";

/**
 * P4.2：域内活动表的旧数据回填。
 *
 * 幂等：只更新 `space_id IS NULL` 的行，把它归入默认空间，
 * 使加列前后行为一致（单空间零变更）。表不存在（synchronize 尚未建表）时跳过。
 */
@Injectable()
export class SpaceBackfillService implements OnModuleInit {
  private readonly logger = new Logger(SpaceBackfillService.name);

  constructor(
    @InjectDataSource("controlplane") private readonly controlPlane: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    let filled = 0;
    let skipped = 0;
    for (const table of SPACE_SCOPED_TABLES) {
      try {
        await this.controlPlane.query(
          `UPDATE "${table}" SET space_id = ? WHERE space_id IS NULL`,
          [SPACE_ID],
        );
        filled += 1;
      } catch (e) {
        skipped += 1;
        this.logger.warn(`空间回填跳过 ${table}：${(e as Error).message}`);
      }
    }
    this.logger.log(`空间回填完成：${filled} 张表，跳过 ${skipped} 张`);
  }
}
