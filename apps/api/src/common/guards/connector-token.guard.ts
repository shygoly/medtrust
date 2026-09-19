import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConnectorAuthService } from "../../runtime/participant-identity/connector-auth.service";
import { canonicalBodySm3 } from "../canonical-json";

/**
 * Outbound connector auth.
 *
 * outbound-longpoll-agent-auth(D5):**缺省即强制证书认证** —— 每个请求都必须带平台 CA
 * 签发证书的 SM2 签名(指纹 + 时间戳 + 签名),且带请求体的上报接口签名覆盖请求体 SM3。
 *
 * 令牌方式只在显式开启开发开关(`CONNECTOR_TOKEN_AUTH_ALLOWED=true`)且显式配置了
 * `CONNECTOR_PULL_TOKEN` 时可用;代码中不再有缺省令牌。
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
        // 请求体参与签名:签名内容 = ts:pid[:bodySm3](两端同规则)。
        bodySm3: canonicalBodySm3(req.body),
      });
      if (result.verified && result.participantId) {
        req.connectorParticipantId = result.participantId;
        req.connectorCertFingerprint = fingerprint;
        return true;
      }
      throw new UnauthorizedException(
        `连接器证书认证失败:${result.reason ?? "未知原因"}`,
      );
    }

    // 令牌降级通道:缺省关闭,且必须显式配置令牌值。
    if (process.env.CONNECTOR_TOKEN_AUTH_ALLOWED !== "true") {
      throw new UnauthorizedException(
        "连接器证书认证为强制模式,拒绝 token 降级（本地开发需显式设置 CONNECTOR_TOKEN_AUTH_ALLOWED=true）",
      );
    }
    const expected = process.env.CONNECTOR_PULL_TOKEN;
    if (!expected) {
      throw new UnauthorizedException(
        "未显式配置 CONNECTOR_PULL_TOKEN,令牌通道不可用",
      );
    }

    const token = String(req.headers["x-connector-token"] ?? "");
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
