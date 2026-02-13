import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@medtrust/database';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, path, user, body } = request;
    
    // 根据 HTTP 方法映射审计动作
    let action: AuditAction;
    switch (method) {
      case 'POST':
        action = AuditAction.CREATE;
        break;
      case 'GET':
        action = AuditAction.READ;
        break;
      case 'PATCH':
      case 'PUT':
        action = AuditAction.UPDATE;
        break;
      case 'DELETE':
        action = AuditAction.DELETE;
        break;
      default:
        action = AuditAction.READ;
    }

    // 提取资源类型
    const resource = path.split('/')[2] || 'unknown';

    const now = Date.now();

    return next.handle().pipe(
      tap(async () => {
        // 只记录有认证用户的请求
        if (user && user.userId) {
          try {
            await this.auditService.create(
              user.userId,
              user.tenantId,
              {
                action,
                resource,
                details: {
                  path,
                  method,
                  requestBody: this.sanitizeBody(body),
                  duration: Date.now() - now,
                },
              },
              request.ip,
              request.headers['user-agent'],
            );
          } catch (error) {
            // 审计日志记录失败不应影响主流程
            console.error('Failed to create audit log:', error);
          }
        }
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    // 移除敏感字段
    const sensitiveFields = ['password', 'token', 'secret', 'creditCard'];
    const sanitized = { ...body };
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***';
      }
    }
    
    return sanitized;
  }
}
