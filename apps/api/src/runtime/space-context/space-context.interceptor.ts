import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { SpaceContextService } from "./space-context.service";
import {
  SPACE_HEADER,
  assertSpaceAllowed,
  resolveRequestedSpace,
  resolveSpaces,
} from "./space-resolver";

/**
 * 空间上下文强制点（P2.1 + P2.2）。
 *
 * 为什么是拦截器而不是守卫：Nest 的执行顺序是 中间件 → 守卫 → 拦截器 → 处理器，
 * 全局守卫会先于路由级 `JwtAuthGuard` 运行，此时 `req.user` 尚未注入。拦截器在
 * 守卫之后运行，因此能同时完成 ① 空间鉴权 ② 建立请求级上下文 ③ 覆盖整条处理链。
 *
 * 未认证请求（无 req.user）直接放行——鉴权由既有 JwtAuthGuard 负责，本拦截器
 * 不改变公开端点的行为（单空间零变更）。
 */
@Injectable()
export class SpaceContextInterceptor implements NestInterceptor {
  constructor(private readonly spaceContext: SpaceContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: { spaces?: readonly string[]; spaceId?: string };
      headers?: Record<string, unknown>;
      spaceId?: string;
      spaceIds?: readonly string[];
    }>();

    const principal = req?.user;
    if (!principal) return next.handle();

    const allowed = resolveSpaces(principal, SPACE_ID);
    const requested = resolveRequestedSpace(req.headers?.[SPACE_HEADER], principal, SPACE_ID);
    const spaceId = assertSpaceAllowed(requested, allowed);

    req.spaceId = spaceId;
    req.spaceIds = allowed;

    const traceHeader = req.headers?.["x-request-id"];
    const value = {
      spaceId,
      traceId: typeof traceHeader === "string" ? traceHeader : undefined,
    };

    // 必须在 storage.run 内**订阅**，否则处理器的异步续体会丢失上下文。
    return new Observable((subscriber) => {
      this.spaceContext.run(value, () => {
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
