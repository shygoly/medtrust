import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "./jwt-secret.util";
import { resolveTenantId } from "./auth.constants";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    // request.user — carries the participant identity used by ParticipantRolesGuard
    return {
      userId: payload.sub,
      email: payload.email,
      participantId: payload.participantId,
      role: payload.role,
      tenantId: resolveTenantId(payload),
    };
  }
}
