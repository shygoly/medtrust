import { Injectable, ServiceUnavailableException } from "@nestjs/common";

// 邮件发送抽象(P0-6)。当前为开发/联调实现:非生产环境把验证码打到控制台,
// 生产环境若未配置 SMTP_URL 则 fail-closed(不假装已发送)。
// 接入真实邮件服务(如 SES / SMTP / 邮件网关)时,替换本类实现即可。
@Injectable()
export class MailService {
  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    const smtpUrl = process.env.SMTP_URL?.trim();
    if (process.env.NODE_ENV === "production" && !smtpUrl) {
      throw new ServiceUnavailableException("邮件服务未配置");
    }
    if (!smtpUrl) {
      // 开发模式:不打真邮件,验证码写入 API 日志便于联调。
      // eslint-disable-next-line no-console
      console.warn(`[mail:dev] password reset code for ${email}: ${code}`);
      return;
    }
    // TODO(P0-6/P1):接入真实 SMTP/SES 发送。SMTP_URL 已登记 DEPLOY.md。
    // eslint-disable-next-line no-console
    console.warn(`[mail] SMTP_URL configured, integrate provider for ${email}`);
  }
}
