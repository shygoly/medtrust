import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";
import { MpcSession } from "@medtrust/database";
import { MpcController } from "./mpc.controller";
import { MpcService } from "./mpc.service";
import { MpSpdzAdapter } from "./adapters/mp-spdz.adapter";

@Module({
  imports: [
    TypeOrmModule.forFeature([MpcSession]),
    HttpModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [MpcController],
  providers: [MpcService, MpSpdzAdapter],
  exports: [MpcService],
})
export class MpcModule {}
