import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

/** Outbound connector auth — shared secret + participant identity (demo / dev). */
@Injectable()
export class ConnectorTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers["x-connector-token"] ?? "");
    const expected = process.env.CONNECTOR_PULL_TOKEN ?? "dev-connector-token";
    if (!token || token !== expected) {
      throw new UnauthorizedException("连接器令牌无效");
    }

    const participantId = String(
      req.query?.participantId ?? req.headers["x-connector-participant"] ?? "",
    ).trim();
    if (!participantId) {
      throw new BadRequestException("缺少 participantId");
    }

    req.connectorParticipantId = participantId;
    return true;
  }
}
