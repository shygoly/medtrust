import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ParticipantRole } from "@medtrust/database";
import { PARTICIPANT_ROLES_KEY } from "./participant-role.decorator";

// Enforces @ParticipantRoles(...) on a route. Runs after JwtAuthGuard, so
// request.user carries { role }. No metadata => no role restriction.
@Injectable()
export class ParticipantRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ParticipantRole[]>(
      PARTICIPANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException(
        `需要参与方角色之一: ${required.join(" / ")}(当前: ${user?.role ?? "无"})`,
      );
    }
    return true;
  }
}
