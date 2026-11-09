import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * 仅限**院内访问**的本地管理接口守卫（D-MDOP-4 第 3 步）。
 *
 * 合约确认 / 撤销是「医院自己的动作」，所以入口开在连接器本地（院内网）：
 *  - 需要 `CONNECTOR_LOCAL_ADMIN_TOKEN`（独立于平台拉取令牌，不配则一律拒——fail-closed）；
 *  - 部署上 MUST NOT 把连接器端口发布到院内网之外（见 deploy/ali29 compose 的 internal 网络）。
 * 代码层能保证的是「没有这个本地令牌就调不动」；网络可达性是部署面的事，如实写在 DEPLOY。
 */
@Injectable()
export class LocalAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers['x-connector-admin-token'] ?? '');
    const expected = (process.env.CONNECTOR_LOCAL_ADMIN_TOKEN ?? '').trim();
    if (!expected) {
      throw new UnauthorizedException(
        '未配置 CONNECTOR_LOCAL_ADMIN_TOKEN：本地管理接口不提供缺省令牌（fail-closed）',
      );
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('本地管理令牌无效');
    }
    // 留痕用：谁确认的（院内人员标识由院内自己填）。
    // HTTP 头只能放 ISO-8859-1，中文必须由调用方 percent-encode（页面已这么做）；
    // 解不开就按原样留痕，不因为编码问题让签署失败。
    const rawActor = String(req.headers['x-connector-admin-actor'] ?? 'local-admin');
    let actor = rawActor;
    try {
      actor = decodeURIComponent(rawActor);
    } catch {
      actor = rawActor;
    }
    req.localAdminActor = actor.slice(0, 120);
    return true;
  }
}
