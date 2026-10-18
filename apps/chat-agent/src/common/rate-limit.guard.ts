import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../config/agent.config';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

interface Window {
  key: string;
  limit: number;
  windowMs: number;
}

const WINDOW_MS = 60_000;

/**
 * 限流闸（4.3.1）。
 *
 * 按「用户」和「IP」两个维度各判一次窗口，任一超限即 429 + Retry-After。
 * 计数放在 `RateLimitStore` 后面：内存实现是每实例的，Redis 实现才是跨实例共享的
 * （`/health/ready` 会如实报告用的是哪一种）。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(AGENT_CONFIG) private readonly config: MedTrustChatConfig,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const perUser = this.config.rateLimitPerUserPerMin;
    const perIp = this.config.rateLimitPerIpPerMin;
    if (perUser <= 0 && perIp <= 0) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';

    const windows: Window[] = [];
    if (perUser > 0 && userId) {
      windows.push({ key: `u:${userId}`, limit: perUser, windowMs: WINDOW_MS });
    }
    if (perIp > 0) {
      windows.push({ key: `i:${ip}`, limit: perIp, windowMs: WINDOW_MS });
    }

    for (const window of windows) {
      const decision = await this.store.hit(window.key, window.windowMs, window.limit);
      if (!decision.allowed) {
        response?.setHeader('Retry-After', String(decision.retryAfterSeconds));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: `请求过于频繁，请 ${decision.retryAfterSeconds} 秒后重试`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
