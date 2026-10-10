import { BadRequestException } from "@nestjs/common";
import {
  MIN_ACCENT_CONTRAST,
  SpaceThemeService,
  THEME_TOKEN_WHITELIST,
  contrastRatio,
  validateBrandingPatch,
} from "./space-theme.service";

function repo(rows: any[] = []) {
  return {
    rows,
    findOne: async (o: any) => rows.find((r) => r.id === o?.where?.id) ?? null,
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      if (i >= 0) rows[i] = { ...rows[i], ...x };
      return x;
    },
  } as any;
}

describe("空间主题（P7 / D-SPD-15）", () => {
  it("白名单：任意 CSS / 白名单外令牌一律拒", () => {
    expect(() => validateBrandingPatch({ fontFamily: "Comic Sans" } as never)).toThrow(/白名单/);
    expect(() => validateBrandingPatch({ css: "body{color:red}" } as never)).toThrow(/白名单/);
    expect(() => validateBrandingPatch({ layout: "grid" } as never)).toThrow(/白名单/);
  });

  it("不可覆盖项：状态语义色 / 功能层令牌不在白名单", () => {
    for (const t of ["statusColors", "--cs-red", "spacing", "fontSize"]) {
      expect(THEME_TOKEN_WHITELIST as readonly string[]).not.toContain(t);
    }
  });

  it("颜色令牌：必须 #rrggbb 且过对比度", () => {
    expect(() => validateBrandingPatch({ primary: "red" })).toThrow(/#rrggbb/);
    // 与页面底色几乎同色的"看不见的品牌色"被拒；本仓 jade 主色通过
    expect(() => validateBrandingPatch({ primary: "#202424" })).toThrow(/对比度/);
    expect(contrastRatio("#202424")).toBeLessThan(MIN_ACCENT_CONTRAST);
    expect(contrastRatio("#3fb6ae")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(validateBrandingPatch({ primary: "#3fb6ae" })).toEqual({ primary: "#3fb6ae" });
  });

  it("图片令牌禁外链（只接受对象存储 key）", () => {
    expect(() => validateBrandingPatch({ logoKey: "https://evil.example/x.png" })).toThrow(/外链/);
    expect(validateBrandingPatch({ logoKey: "branding/s1/logo.png" })).toEqual({
      logoKey: "branding/s1/logo.png",
    });
  });

  it("级联：平台默认 → 实例品牌 → 空间主题，逐项回落", async () => {
    process.env.INSTANCE_BRAND_TITLE = "某省电力可信数据空间";
    process.env.INSTANCE_BRAND_PRIMARY = "#3fb6ae";
    try {
      const svc = new SpaceThemeService(repo([{ id: "s1", branding: { shortName: "车网" } }]));
      const t = await svc.resolve("s1");
      expect(t.title).toBe("某省电力可信数据空间"); // 实例品牌
      expect(t.shortName).toBe("车网"); // 空间覆盖
      expect(t.source).toBe("space");

      const svc2 = new SpaceThemeService(repo([{ id: "s2" }]));
      const t2 = await svc2.resolve("s2");
      expect(t2.title).toBe("某省电力可信数据空间");
      expect(t2.source).toBe("instance");
    } finally {
      delete process.env.INSTANCE_BRAND_TITLE;
      delete process.env.INSTANCE_BRAND_PRIMARY;
    }
  });

  it("无实例品牌与空间主题时回落平台默认", async () => {
    const svc = new SpaceThemeService(repo([{ id: "s3" }]));
    const t = await svc.resolve("s3");
    expect(t.source).toBe("platform");
    expect(t.title).toContain("MedTrust");
  });

  it("联邦边界：远端空间只给标识，不注入样式令牌", () => {
    const svc = new SpaceThemeService(repo());
    const remote = svc.remoteIdentity("remote-1", "远端空间", "remote/logo.png");
    expect(remote.injectTokens).toBe(false);
    expect(Object.keys(remote).sort()).toEqual(["injectTokens", "logoKey", "name", "spaceId"]);
  });

  it("更新：合并写入并按 actor 留痕", async () => {
    const r = repo([{ id: "s1", branding: { title: "旧标题" } }]);
    const svc = new SpaceThemeService(r);
    const out = await svc.update("s1", { shortName: "新简称" }, "ops@example.com");
    expect(out.title).toBe("旧标题");
    expect(out.shortName).toBe("新简称");
  });

  it("负例：更新不存在的空间即拒", async () => {
    const svc = new SpaceThemeService(repo());
    await expect(svc.update("nope", { title: "x" })).rejects.toThrow(/不存在/);
  });
});
