import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ComputeTaskService } from "./compute-task.service";
import { ComputeTaskController } from "./compute-task.controller";
import { ComputeTask } from "@medtrust/database";

@Module({
  imports: [TypeOrmModule.forFeature([ComputeTask])],
  controllers: [ComputeTaskController],
  providers: [ComputeTaskService],
  exports: [ComputeTaskService],
})
export class ComputeTaskModule {}
