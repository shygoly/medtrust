import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * 取当前请求的空间 id（由 SpaceContextInterceptor 校验并写入）。
 * 使用处只依赖这个装饰器，MUST NOT 直接读 process.env.SPACE_ID（D-SPD-2）。
 */
export const CurrentSpace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<{ spaceId?: string }>()?.spaceId,
);
