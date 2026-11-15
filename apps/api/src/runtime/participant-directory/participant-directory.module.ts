import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ParticipantIdentity } from "@medtrust/database";
import { ParticipantDisplayService } from "./participant-display.service";

/**
 * 参与方展示名解析（非基座目录）。
 *
 * 只读 `cp_participant.org`，被目录浏览与合约浏览共用；放在基座目录之外，
 * 避免把「机构名怎么来」的展示策略塞进 identity 基座（check-kernel-purity）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([ParticipantIdentity], "controlplane")],
  providers: [ParticipantDisplayService],
  exports: [ParticipantDisplayService],
})
export class ParticipantDirectoryModule {}
