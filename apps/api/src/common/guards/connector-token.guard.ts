import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConnectorAuthService } from "../../runtime/participant-identity/connector-auth.service";

/**
 * Outbound connector auth.
 * P1-4:优先验证 SM2 证书签名(指纹+时间戳+签名),吊销/过期即拒;
 * 未携带证书头时回退共享 token(降级通道,可用 CONNECTOR_CERT_AUTH_REQUIRED=true 关闭)。
 */
@Injectable()
export class ConnectorTokenGuard implements CanActivate {
  constructor(private readonly connectorAuth: ConnectorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const fingerprint = String(
      req.headers["x-connector-cert-fingerprint"] ?? "",
    ).trim();
    const timestamp = String(req.headers["x-connector-timestamp"] ?? "").trim();
    const signature = String(req.headers["x-connector-signature"] ?? "").trim();

    if (fingerprint || timestamp || signature) {
      const result = await this.connectorAuth.verifyRequest({
        fingerprint,
        timestamp,
        signature,
      });
      if (result.verified && result.participantId) {
        req.connectorParticipantId = result.participantId;
        return true;
      }
      throw new UnauthorizedException(
        `连接器证书认证失败:${result.reason ?? "未知原因"}`,
      );
    }

    if (process.env.CONNECTOR_CERT_AUTH_REQUIRED === "true") {
      throw new UnauthorizedException(
        "连接器证书认证为强制模式,拒绝 token 降级",
      );
    }

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
