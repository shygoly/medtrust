import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SpaceEntity, type SpaceBranding } from "@medtrust/database";

/**
 * 可被空间覆盖的白名单令牌（D-SPD-15）。
 * **与 DESIGN.md「主题令牌契约」表对拍**（scripts/check-theme.mjs 守护）。
 * 不可覆盖：状态语义色映射、功能层（布局/间距/字号/组件）、能力层（页面集合）。
 */
export const THEME_TOKEN_WHITELIST = [
  "logoKey",
  "faviconKey",
  "title",
  "shortName",
  "primary",
  "accent",
] as const;

export type ThemeToken = (typeof THEME_TOKEN_WHITELIST)[number];

/**
 * 品牌色与**页面底色**的最小对比度（WCAG AA 非文本/大字号 3.0）。
 * 防的是"空间管理员把品牌色配成与底色几乎一样、按钮看不见"。
 */
export const MIN_ACCENT_CONTRAST = 3.0;
/** 参照页面底色亮度（近似 --cs-bg 的 oklch 0.16 深石墨）。 */
const PAGE_BACKGROUND_LUMINANCE = 0.012;

export interface ResolvedTheme extends SpaceBranding {
  source: "space" | "instance" | "platform";
}

function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 与参照文字亮度的对比度；非法颜色返回 0（必然不达标）。 */
export function contrastRatio(hex: string, other = PAGE_BACKGROUND_LUMINANCE): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const l = luminance(rgb);
  const [hi, lo] = l > other ? [l, other] : [other, l];
  return (hi + 0.05) / (lo + 0.05);
}

function stripEmpty(input: SpaceBranding | null | undefined): SpaceBranding {
  const out: SpaceBranding = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === "string" && v.trim()) (out as never as Record<string, string>)[k] = v;
  }
  return out;
}

function hasAny(input: SpaceBranding | null | undefined): boolean {
  return Object.keys(stripEmpty(input)).length > 0;
}

/**
 * 校验主题补丁（D-SPD-15）：
 *   ① 令牌必须在白名单内（**任意 CSS 一律拒**）
 *   ② 值必须是字符串
 *   ③ 颜色令牌须为 #rrggbb 且过对比度阈值
 *   ④ image 令牌禁外链（只接受对象存储 key）
 */
export function validateBrandingPatch(patch: SpaceBranding): SpaceBranding {
  const out: SpaceBranding = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    if (!(THEME_TOKEN_WHITELIST as readonly string[]).includes(key)) {
      throw new BadRequestException("主题令牌不在白名单内：" + key);
    }
    if (typeof value !== "string") {
      throw new BadRequestException("主题令牌必须是字符串：" + key);
    }
    const v = value.trim();
    if (key === "primary" || key === "accent") {
      if (!parseHex(v)) throw new BadRequestException("颜色令牌必须是 #rrggbb：" + key);
      if (contrastRatio(v) < MIN_ACCENT_CONTRAST) {
        throw new BadRequestException(
          "颜色与页面底色对比度不足（<" + MIN_ACCENT_CONTRAST + "）：" + key,
        );
      }
    }
    if ((key === "logoKey" || key === "faviconKey") && /^https?:/i.test(v)) {
      throw new BadRequestException("图片令牌禁外链，只接受对象存储 key：" + key);
    }
    (out as never as Record<string, string>)[key] = v;
  }
  return out;
}

@Injectable()
export class SpaceThemeService {
  private readonly logger = new Logger(SpaceThemeService.name);

  constructor(
    @InjectRepository(SpaceEntity, "controlplane")
    private readonly spaces: Repository<SpaceEntity>,
  ) {}

  /** 平台默认（与 DESIGN.md 的 Vital Ink 权威主题一致）。 */
  platformBranding(): SpaceBranding {
    return { title: "MedTrust 可信数据空间", primary: "#3fb6ae" };
  }

  /** 实例品牌（部署配置兜底；开源后由部署者设置）。 */
  instanceBranding(): SpaceBranding {
    return {
      title: process.env.INSTANCE_BRAND_TITLE?.trim() || undefined,
      logoKey: process.env.INSTANCE_BRAND_LOGO?.trim() || undefined,
      primary: process.env.INSTANCE_BRAND_PRIMARY?.trim() || undefined,
    };
  }

  /** 级联：平台默认 → 实例品牌 → 空间主题；缺字段逐项回落。 */
  async resolve(spaceId: string): Promise<ResolvedTheme> {
    const space = await this.spaces.findOne({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("空间不存在");
    const instance = stripEmpty(this.instanceBranding());
    const spaceBranding = stripEmpty(space.branding);
    const merged: SpaceBranding = {
      ...this.platformBranding(),
      ...instance,
      ...spaceBranding,
    };
    const source: ResolvedTheme["source"] = hasAny(space.branding)
      ? "space"
      : hasAny(instance)
        ? "instance"
        : "platform";
    return { ...merged, source };
  }

  /**
   * 联邦边界（D-SPD-15）：远端空间只给标识，
   * **不注入样式令牌**（防跨实例样式注入 / 追踪 / 钓鱼）。
   */
  remoteIdentity(spaceId: string, name: string, logoKey?: string) {
    return { spaceId, name, logoKey: logoKey ?? null, injectTokens: false as const };
  }

  /** 更新空间主题；变更留痕（谁 / 何时 / 改了哪些令牌）。 */
  async update(
    spaceId: string,
    patch: SpaceBranding,
    actor?: string,
  ): Promise<SpaceBranding> {
    const space = await this.spaces.findOne({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("空间不存在");
    const clean = validateBrandingPatch(patch);
    space.branding = { ...(space.branding ?? {}), ...clean };
    await this.spaces.save(space);
    this.logger.log(
      "[theme-audit] space=" + spaceId +
        " actor=" + (actor ?? "unknown") +
        " tokens=" + Object.keys(clean).sort().join(","),
    );
    return space.branding;
  }
}
