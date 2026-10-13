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

  it("未确权产品即使标成 active 也不进入在架目录", async () => {
    const repo = mockRepo();
    await repo.save({
      id: "draft",
      title: "未确权",
      status: "active",
      rightsConfirmed: false,
      homeSpace: "sh-med",
      providerId: "p",
      productType: "data",
    });
    await repo.save({
      id: "live",
      title: "已确权",
      status: "active",
      rightsConfirmed: true,
      homeSpace: "sh-med",
      providerId: "p",
      productType: "data",
    });
    const local = new CatalogService(repo);
    expect((await local.list()).map((p) => p.id)).toEqual(["live"]);
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

  it("有空间上下文时目录只返回该空间的产品", async () => {
    const repo = mockRepo();
    const here = new CatalogService(repo, {
      current: () => ({ spaceId: "s-here" }),
    } as any);
    const there = new CatalogService(repo, {
      current: () => ({ spaceId: "s-there" }),
    } as any);
    const mine = await here.publish({
      providerId: "h-1",
      title: "本空间",
      classification: "一般",
      rightsConfirmed: true,
    });
    await there.publish({
      providerId: "h-2",
      title: "其他空间",
      classification: "一般",
      rightsConfirmed: true,
    });
    const listed = await here.list();
    expect(listed.map((p) => p.title)).toEqual(["本空间"]);
    expect(await here.get(mine.id)).toMatchObject({ title: "本空间" });
    expect(await there.get(mine.id)).toBeNull();
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

  it("publishes a service-type product and filters by type", async () => {
    await svc.publish({
      providerId: "h-1",
      title: "data-x",
      classification: "一般",
      rightsConfirmed: true,
      productType: "data",
    });
    const svc2 = await svc.publish({
      providerId: "h-2",
      title: "svc-x",
      classification: "一般",
      rightsConfirmed: true,
      productType: "service",
    });
    expect(svc2.productType).toBe("service");
    const services = await svc.list("service");
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe(svc2.id);
    const dataOnly = await svc.list("data");
    expect(dataOnly).toHaveLength(1);
    expect(dataOnly[0].productType).toBe("data");
  });
});

// omop-data-source-access —— 数据源声明(4.1 / D-CN-6)与 CDM 覆盖元数据(5.2–5.4)。
describe("CatalogService — 数据源声明与 CDM 覆盖元数据", () => {
  let svc: CatalogService;
  beforeEach(() => {
    svc = new CatalogService(mockRepo());
  });

  const publishCdm = (providerId: string, label: string, title = "CDM") =>
    svc.publish({
      providerId,
      title,
      classification: "敏感",
      rightsConfirmed: true,
      fhirSchema: { dataSource: { type: "omop-cdm", label } },
    });

  const goodReport = (vocab = "v5.0 31-AUG-24") => ({
    passed: true,
    cdmVersion: "5.4",
    vocabularyVersion: vocab,
    coverage: {
      tables: [
        { table: "person", magnitude: 5 },
        { table: "drug_exposure", magnitude: null },
      ],
      timeSpan: { from: "2018-03", to: "2024-11" },
      computedAt: "2026-09-20T08:00:00.000Z",
    },
  });

  it("发布时拒绝在 CDM 声明里放连接信息——控制面不持有院内库凭据(D-CN-6)", async () => {
    await expect(
      svc.publish({
        providerId: "h-1",
        title: "x",
        classification: "敏感",
        rightsConfirmed: true,
        fhirSchema: {
          dataSource: {
            type: "omop-cdm",
            label: "main-cdm",
            connectionString: "postgres://connector:secret@10.0.0.5/omop",
          },
        },
      }),
    ).rejects.toThrow(/只允许 type 与 label/);
    expect(await svc.list()).toHaveLength(0);
  });

  it("发布时拒绝类型歧义:CDM 声明不得再带文件路径", async () => {
    await expect(
      svc.publish({
        providerId: "h-1",
        title: "x",
        classification: "敏感",
        rightsConfirmed: true,
        fhirSchema: {
          dataSource: { type: "omop-cdm", label: "main-cdm" },
          localDataPath: "data/synthea/connectors/demohospa",
        },
      }),
    ).rejects.toThrow(/数据源类型必须唯一/);
  });

  it("上报只挂到该机构声明了这个 label 的 CDM 产品上", async () => {
    const mine = await publishCdm("h-1", "main-cdm");
    const otherLabel = await publishCdm("h-1", "other-cdm");
    const otherOrg = await publishCdm("h-2", "main-cdm");
    const fileProduct = await svc.publish({
      providerId: "h-1",
      title: "file",
      classification: "一般",
      rightsConfirmed: true,
      fhirSchema: { localDataPath: "data/x" },
    });

    const res = await svc.applyCoverageReport("h-1", "main-cdm", goodReport());
    expect(res).toEqual({ matched: 1, updated: 1 });

    const stored = await svc.get(mine.id);
    expect(stored?.coverage).toMatchObject({
      label: "main-cdm",
      cdmVersion: "5.4",
      vocabularyVersion: "v5.0 31-AUG-24",
      timeSpan: { from: "2018-03", to: "2024-11" },
      stale: false,
      staleReason: null,
    });
    expect(stored?.coverage?.tables).toContainEqual({
      table: "drug_exposure",
      magnitude: null,
    });
    for (const id of [otherLabel.id, otherOrg.id, fileProduct.id]) {
      expect((await svc.get(id))?.coverage ?? null).toBeNull();
    }
  });

  it("只收统计量:任何多余字段整份拒收,目录不落半点", async () => {
    const p = await publishCdm("h-1", "main-cdm");
    await expect(
      svc.applyCoverageReport("h-1", "main-cdm", {
        ...goodReport(),
        rows: [{ person_id: 1, condition: "AKI" }],
      }),
    ).rejects.toThrow(/不允许的字段/);
    await expect(
      svc.applyCoverageReport("h-1", "main-cdm", {
        ...goodReport(),
        coverage: {
          ...goodReport().coverage,
          timeSpan: { from: "2018-03-15", to: "2024-11-02" },
        },
      }),
    ).rejects.toThrow(/YYYY-MM/);
    expect((await svc.get(p.id))?.coverage ?? null).toBeNull();
  });

  it("版本变了而统计没跟上 → 版本照实更新,覆盖标待刷新(5.4)", async () => {
    const p = await publishCdm("h-1", "main-cdm");
    await svc.applyCoverageReport("h-1", "main-cdm", goodReport());
    await svc.applyCoverageReport("h-1", "main-cdm", {
      passed: true,
      cdmVersion: "5.4",
      vocabularyVersion: "v5.0 30-AUG-26",
      coverage: null,
    });
    const c = (await svc.get(p.id))?.coverage;
    expect(c?.vocabularyVersion).toBe("v5.0 30-AUG-26");
    expect(c?.stale).toBe(true);
    expect(c?.staleReason).toMatch(/v5\.0 31-AUG-24→v5\.0 30-AUG-26/);
    // 新统计到来 → 恢复新鲜
    await svc.applyCoverageReport(
      "h-1",
      "main-cdm",
      goodReport("v5.0 30-AUG-26"),
    );
    expect((await svc.get(p.id))?.coverage?.stale).toBe(false);
  });

  it("版本没变、只是这次没算出统计 → 目录不动", async () => {
    const p = await publishCdm("h-1", "main-cdm");
    await svc.applyCoverageReport("h-1", "main-cdm", goodReport());
    const res = await svc.applyCoverageReport("h-1", "main-cdm", {
      passed: true,
      cdmVersion: "5.4",
      vocabularyVersion: "v5.0 31-AUG-24",
      coverage: null,
    });
    expect(res).toEqual({ matched: 1, updated: 0 });
    expect((await svc.get(p.id))?.coverage?.stale).toBe(false);
  });

  it("数据源接入校验没过 → 已登记的覆盖标待刷新,不以旧面目继续呈现", async () => {
    const p = await publishCdm("h-1", "main-cdm");
    await svc.applyCoverageReport("h-1", "main-cdm", goodReport());
    await svc.applyCoverageReport("h-1", "main-cdm", { passed: false });
    const c = (await svc.get(p.id))?.coverage;
    expect(c?.stale).toBe(true);
    expect(c?.staleReason).toMatch(/接入校验未通过/);
    // 校验失败的报文里只能有一个布尔
    await expect(
      svc.applyCoverageReport("h-1", "main-cdm", {
        passed: false,
        detail: "cdm_raw 可读",
      }),
    ).rejects.toThrow(/不允许的字段/);
  });

  it("改了数据源声明,旧 label 的覆盖元数据随之清掉", async () => {
    const p = await publishCdm("h-1", "main-cdm");
    await svc.applyCoverageReport("h-1", "main-cdm", goodReport());
    await svc.update(p.id, {
      fhirSchema: { dataSource: { type: "omop-cdm", label: "new-cdm" } },
    });
    expect((await svc.get(p.id))?.coverage ?? null).toBeNull();
  });
});
