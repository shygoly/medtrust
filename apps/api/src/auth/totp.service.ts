import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";

// P2-4:TOTP 多因素认证(RFC 6238,30s 窗口,6 位数字,HMAC-SHA1)。
// 无第三方依赖;用户扫码 otpauth:// URL 绑定到 Google Authenticator / 信通院客户端等。
const WINDOW_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

@Injectable()
export class TotpService {
  generateSecret(): string {
    const bytes = randomBytes(20);
    return this.base32Encode(bytes);
  }

  otpauthUrl(secret: string, account: string, issuer = "MedTrust"): string {
    const label = encodeURIComponent(`${issuer}:${account}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${WINDOW_SECONDS}`;
  }

  generate(secret: string, timestamp = Date.now()): string {
    const counter = Math.floor(timestamp / 1000 / WINDOW_SECONDS);
    const buf = Buffer.alloc(8);
    // 64-bit big-endian counter
    let c = counter;
    for (let i = 7; i >= 0; i--) {
      buf[i] = c & 0xff;
      c = Math.floor(c / 256);
    }
    const hmac = createHmac("sha1", this.base32Decode(secret))
      .update(buf)
      .digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const otp = binary % 10 ** DIGITS;
    return String(otp).padStart(DIGITS, "0");
  }

  verify(secret: string, token: string): boolean {
    if (!secret || !token) return false;
    const now = Date.now();
    for (const offset of [-1, 0, 1]) {
      if (this.generate(secret, now + offset * WINDOW_SECONDS * 1000) === token) {
        return true;
      }
    }
    return false;
  }

  private base32Encode(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = "";
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  private base32Decode(secret: string): Buffer {
    const clean = secret.replace(/=+$/, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
      const idx = ALPHABET.indexOf(ch);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(out);
  }
}
