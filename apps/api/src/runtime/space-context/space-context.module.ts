import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import "./space-scope.registration";
import { SpaceBackfillService } from "./space-backfill.service";
import { SpaceContextInterceptor } from "./space-context.interceptor";
import { SpaceContextService } from "./space-context.service";
import { SpaceScopeService } from "./space-scope.service";
import { MeteringService } from "./metering.service";

/**
 * 空间上下文全局模块（P2）。
 * 全局拦截器对**已认证**请求强制空间校验并建立请求级上下文；未认证请求放行。
 */
@Global()
@Module({
  providers: [
    SpaceContextService,
    SpaceScopeService,
    SpaceBackfillService,
    MeteringService,
    { provide: APP_INTERCEPTOR, useClass: SpaceContextInterceptor },
  ],
  exports: [SpaceContextService, SpaceScopeService, MeteringService],
})
export class SpaceContextModule {}
