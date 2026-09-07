import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataProduct, Favorite } from "@medtrust/database";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Favorite]),
    TypeOrmModule.forFeature([DataProduct], "controlplane"),
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
