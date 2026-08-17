import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User, XianUserLink } from "@medtrust/database";
import { AuthModule } from "../../auth/auth.module";
import { XianOpenApiController } from "./xian-open-api.controller";
import { XianOpenApiService } from "./xian-open-api.service";
import { XianHeaderService } from "./xian-header.service";
import { XianNonceStore } from "./xian-nonce.store";

// 西安节点能力中心三方应用集成（PDF §6/§7）：用户同步 + 可信免登。
@Module({
  imports: [TypeOrmModule.forFeature([User, XianUserLink]), AuthModule],
  controllers: [XianOpenApiController],
  providers: [XianOpenApiService, XianHeaderService, XianNonceStore],
})
export class XianIntegrationModule {}
