import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * 连接器**本地**管理接口的共享密钥守卫（院内网，与平台信道是两回事）。
 * outbound-longpoll-agent-auth D5:不再有缺省令牌 —— 未显式配置 `CONNECTOR_PULL_TOKEN`
 * 时一律拒绝（fail-closed），避免"代码里写死一个谁都知道的口令"。
 */
@Injectable()
export class ConnectorTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers['x-connector-token'] ?? '');
    const expected = process.env.CONNECTOR_PULL_TOKEN ?? '';
    if (!expected) {
      throw new UnauthorizedException(
        '未显式配置 CONNECTOR_PULL_TOKEN:连接器本地接口不提供缺省令牌',
      );
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('连接器令牌无效');
    }

    const participantId = String(
      req.query?.participantId ?? req.headers['x-connector-participant'] ?? '',
    ).trim();
    if (!participantId) {
      throw new BadRequestException('缺少 participantId');
    }

    req.connectorParticipantId = participantId;
    return true;
  }
}
