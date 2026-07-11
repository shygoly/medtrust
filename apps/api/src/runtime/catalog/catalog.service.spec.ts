import { BadRequestException } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("CatalogService — 目录(数据产品元数据)", () => {
  let svc: CatalogService;
  beforeEach(() => {
    svc = new CatalogService(mockRepo());
  });

  it("publishes a confirmed + classified data product", async () => {
    const p = await svc.publish({
      providerId: "h-1",
      title: "紫杉醇用药记录",
      classification: "敏感",
      rightsConfirmed: true,
      recordCount: 184_300,
    });
    expect(p.id).toBeTruthy();
    expect(await svc.list()).toHaveLength(1);
  });

  it("rejects publishing an unconfirmed data product", async () => {
    await expect(
      svc.publish({
        providerId: "h-1",
        title: "x",
        classification: "敏感",
        rightsConfirmed: false,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects publishing an unclassified data product", async () => {
    await expect(
      svc.publish({ providerId: "h-1", title: "x", rightsConfirmed: true }),
    ).rejects.toThrow(/未分级分类/);
  });

  it("9.1 assigns a global URN + homeSpace on publish", async () => {
    const p = await svc.publish({
      providerId: "h-1",
      title: "x",
      classification: "一般",
      rightsConfirmed: true,
    });
    expect(p.urn).toMatch(/^urn:tds:[^:]+:/);
    expect(p.homeSpace).toBeTruthy();
    expect(p.urn).toContain(p.homeSpace);
  });

  it("catalog metadata carries no raw rows", async () => {
    const p = await svc.publish({
      providerId: "h-1",
      title: "x",
      classification: "一般",
      rightsConfirmed: true,
    });
    expect(Object.keys(p)).not.toContain("rows");
    expect(Object.keys(p)).not.toContain("data");
  });
});
