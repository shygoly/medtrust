import { CatalogController } from "./catalog.controller";
import type { CatalogService } from "./catalog.service";
import type { CollaborationService } from "../space/collaboration.service";

const row = (id: string) => ({
  id,
  urn: `urn:tds:sh-med:${id}`,
  homeSpace: "sh-med",
  providerId: "p-demohospa",
  title: id,
  rightsConfirmed: true,
  recordCount: 1,
  fhirSchema: null,
});

describe("CatalogController — 目录浏览协作过滤（catalog-browse-display 1.4）", () => {
  it("协作隐藏只做剔除，结果保持服务层排序（子序列）", async () => {
    const ordered = ["p-new", "p-tie-a", "p-tie-b", "p-old"].map(row);
    const catalog = { list: async () => ordered } as unknown as CatalogService;
    const collaborations = {
      hiddenProductIds: async () => new Set(["p-tie-b"]),
    } as unknown as CollaborationService;
    const controller = new CatalogController(catalog, collaborations);

    const out = await controller.list(undefined, undefined, "sh-med", {
      user: { participantId: "p-consumer" },
    });
    expect(out.map((p) => p.id)).toEqual(["p-new", "p-tie-a", "p-old"]);
  });

  it("无请求空间时原样返回（不构造协作过滤）", async () => {
    const ordered = ["p-1", "p-2"].map(row);
    const catalog = { list: async () => ordered } as unknown as CatalogService;
    const collaborations = {
      hiddenProductIds: async () => {
        throw new Error("should not be called");
      },
    } as unknown as CollaborationService;
    const controller = new CatalogController(catalog, collaborations);

    const out = await controller.list(undefined, undefined, undefined, {
      user: { participantId: "p-consumer" },
    });
    expect(out.map((p) => p.id)).toEqual(["p-1", "p-2"]);
  });
});
