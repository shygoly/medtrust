import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SpaceEntity } from "@medtrust/database";
import { SpaceController } from "./space.controller";
import { SpaceService } from "./space.service";

// 空间基础管理(6.5)。持久化到 control-plane 连接(D7 物理隔离)。
@Module({
  imports: [TypeOrmModule.forFeature([SpaceEntity], "controlplane")],
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}
