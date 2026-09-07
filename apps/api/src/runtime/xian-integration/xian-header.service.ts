import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { XianApiError } from "./xian-api-error";
import { XianNonceStore } from "./xian-nonce.store";

export const XIAN_NONCE_TTL_MS = 300000;

export interface XianHeaders {
  [name: string]: string | string[] | undefined;
}

@Injectable()
export class XianHeaderService {
  constructor(
    private readonly configService: ConfigService,
    private readonly nonces: XianNonceStore,
  ) {}

  validate(headers: XianHeaders): { traceId: string } {
    const appKey = this.configService.get<string>("XIAN_APP_KEY");
    if (!appKey) {
      throw new XianApiError("SYSTEM_ERROR", "XIAN_APP_KEY not configured");
    }

    const one = (name: string): string => {
      const v = headers[name];
      return String(Array.isArray(v) ? v[0] : (v ?? "")).trim();
    };

    if (one("x-app-key") !== appKey) {
      throw new XianApiError("SYSTEM_ERROR", "invalid X-App-Key");
    }

    const timestamp = one("x-timestamp");
    const offset =
      this.configService.get<string>("XIAN_TIMESTAMP_TZ_OFFSET") || "+08:00";
    const ts = new Date(timestamp.replace(" ", "T") + offset).getTime();
    if (!Number.isFinite(ts)) {
      throw new XianApiError("LOGIN_EXPIRED", "invalid X-Timestamp");
    }
    const windowMs = Number(
      this.configService.get("XIAN_TIMESTAMP_WINDOW_MS") ?? 300000,
    );
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new XianApiError(
        "SYSTEM_ERROR",
        "invalid XIAN_TIMESTAMP_WINDOW_MS",
      );
    }
    if (Math.abs(Date.now() - ts) > windowMs) {
      throw new XianApiError("LOGIN_EXPIRED", "X-Timestamp expired");
    }

    const nonce = one("x-nonce");
    if (!this.nonces.claim(nonce, XIAN_NONCE_TTL_MS)) {
      throw new XianApiError("INVALID_NONCE", "duplicate X-Nonce");
    }

    const traceId = one("x-trace-id");
    if (!traceId) {
      throw new XianApiError("SYSTEM_ERROR", "missing X-Trace-Id");
    }
    return { traceId };
  }
}
