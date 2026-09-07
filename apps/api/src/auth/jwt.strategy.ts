import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "@medtrust/database";
import { getJwtSecret } from "./jwt-secret.util";
import { resolveTenantId } from "./auth.constants";

// P0-2:JWT 验签后查库兜底——禁用/注销用户的 access token 在缓存窗口
// (默认 60s)后失效,不依赖 token 自然过期。缓存避免每个请求都打库。
const USER_CHECK_TTL_MS = 60_000;

interface CachedUserCheck {
  ok: boolean;
  expiresAt: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly userCheckCache = new Map<number, CachedUserCheck>();

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    const userId = Number(payload.sub);
    if (!userId) throw new UnauthorizedException("Invalid token payload");

    if (!(await this.isUserUsable(userId))) {
      throw new UnauthorizedException("账号已禁用或注销");
    }

    // request.user — carries the participant identity used by ParticipantRolesGuard
    return {
      userId,
      email: payload.email,
      participantId: payload.participantId,
      role: payload.role,
      tenantId: resolveTenantId(payload),
    };
  }

  private async isUserUsable(userId: number): Promise<boolean> {
    const cached = this.userCheckCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.ok;

    const user = await this.users.findOne({ where: { id: userId } });
    const ok =
      !!user && !user.deletedAt && user.status !== "disabled";
    this.userCheckCache.set(userId, {
      ok,
      expiresAt: Date.now() + USER_CHECK_TTL_MS,
    });
    return ok;
  }
}
