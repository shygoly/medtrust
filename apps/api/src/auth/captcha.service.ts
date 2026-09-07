import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThan, MoreThan, Repository } from "typeorm";
import { createHash, randomBytes, randomUUID } from "crypto";
import { AuthCaptcha } from "@medtrust/database";

export interface CaptchaChallenge {
  captchaId: string;
  /** data:image/svg+xml;base64,... 可直接用于 <img src>。 */
  image: string;
  expiresInSeconds: number;
}

const CAPTCHA_TTL_MS = 5 * 60_000;
// 去除易混淆字符(0/O、1/I/l、o、q、g 等)后的高可读字符集。
const CAPTCHA_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const CAPTCHA_LENGTH = 4;

// 图形验证码(P0-3)。答案只存 SHA-256 哈希;验证通过即置 used_at(一次性)。
// 持久化在默认库 auth_captchas 表;多实例部署需换共享存储(整改计划 P0-3 备注)。
@Injectable()
export class CaptchaService {
  constructor(
    @InjectRepository(AuthCaptcha)
    private readonly captchas: Repository<AuthCaptcha>,
  ) {}

  async generate(): Promise<CaptchaChallenge> {
    // 顺带清理过期记录,避免表无限增长。
    await this.captchas.delete({ expiresAt: LessThan(new Date()) });

    const code = Array.from({ length: CAPTCHA_LENGTH }, () => {
      const i = randomBytes(1)[0] % CAPTCHA_CHARS.length;
      return CAPTCHA_CHARS[i];
    }).join("");
    const id = randomUUID();
    await this.captchas.save(
      this.captchas.create({
        id,
        answerHash: this.hash(code.toLowerCase()),
        expiresAt: new Date(Date.now() + CAPTCHA_TTL_MS),
      }),
    );
    return {
      captchaId: id,
      image: this.toDataUrl(this.renderSvg(code)),
      expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000),
    };
  }

  /**
   * 校验并原子占用验证码。答案错误不占用(允许用户重试);答案正确才置 used_at,
   * 且用 usedAt IS NULL 条件抢占,防并发重放。任何失败都返回 false(不区分原因)。
   */
  async verify(id: string, code: string): Promise<boolean> {
    if (!id || !code) return false;
    const row = await this.captchas.findOne({ where: { id } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return false;
    }
    if (row.answerHash !== this.hash(code.trim().toLowerCase())) {
      return false;
    }
    const claimed = await this.captchas.update(
      { id, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { usedAt: new Date() },
    );
    return claimed.affected === 1;
  }

  private hash(answer: string): string {
    return createHash("sha256").update(answer).digest("hex");
  }

  private toDataUrl(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  // 自绘 SVG 验证码(120x40):旋转字符 + 干扰线 + 噪点,无第三方依赖。
  private renderSvg(code: string): string {
    const colors = ["#2563eb", "#0f766e", "#9333ea", "#c2410c", "#1e40af"];
    const chars = code
      .split("")
      .map((ch, i) => {
        const x = 18 + i * 26;
        const y = 26 + (i % 2 === 0 ? -4 : 4);
        const rotate = (i % 2 === 0 ? -1 : 1) * (8 + (i * 5) % 10);
        const color = colors[i % colors.length];
        return `<text x="${x}" y="${y}" font-size="24" font-family="monospace" font-weight="700" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
      })
      .join("");
    const lines = Array.from({ length: 4 }, (_, i) => {
      const y1 = 6 + i * 9;
      const y2 = 10 + ((i * 13) % 24);
      return `<line x1="${4 + i * 8}" y1="${y1}" x2="${110 - i * 6}" y2="${y2}" stroke="${colors[i % colors.length]}" stroke-width="1" opacity="0.35" />`;
    }).join("");
    const dots = Array.from({ length: 24 }, (_, i) => {
      const x = (i * 17 + 5) % 120;
      const y = (i * 11 + 3) % 40;
      return `<circle cx="${x}" cy="${y}" r="1" fill="${colors[i % colors.length]}" opacity="0.3" />`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>${lines}${dots}${chars}</svg>`;
  }
}
