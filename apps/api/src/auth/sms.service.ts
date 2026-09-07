import { Injectable, ServiceUnavailableException } from "@nestjs/common";

// 短信发送抽象(P1-2)。开发/联调实现:非生产环境把验证码打到控制台;
// 生产环境若未配置 SMS_GATEWAY_URL 则 fail-closed(不假装已发送)。
// 接入阿里云/腾讯云短信时,替换本类实现或按 SMS_GATEWAY_URL 调用网关。
@Injectable()
export class SmsService {
  async sendLoginCode(phone: string, code: string): Promise<void> {
    await this.send(phone, code, "login");
  }

  async sendPasswordResetCode(phone: string, code: string): Promise<void> {
    await this.send(phone, code, "password-reset");
  }

  private async send(phone: string, code: string, purpose: string): Promise<void> {
    const gatewayUrl = process.env.SMS_GATEWAY_URL?.trim();
    if (process.env.NODE_ENV === "production" && !gatewayUrl) {
      throw new ServiceUnavailableException("短信服务未配置");
    }
    if (!gatewayUrl) {
      // 开发模式:不打真短信,验证码写入 API 日志便于联调。
      // eslint-disable-next-line no-console
      console.warn(`[sms:dev] ${purpose} code for ${phone}: ${code}`);
      return;
    }
    // TODO(P1-2/P2):接入真实短信网关(SMS_GATEWAY_URL + 签名/模板)。
    // eslint-disable-next-line no-console
    console.warn(`[sms] SMS_GATEWAY_URL configured, integrate provider for ${phone}`);
  }
}
