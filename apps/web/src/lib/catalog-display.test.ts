import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogClassificationLabel,
  catalogDataSourceSummary,
  catalogFieldRows,
  catalogIdHint,
  catalogListingScopeLabel,
  catalogProviderName,
  catalogScaleLabel,
  catalogStatusLabel,
  formatCatalogTime,
  type CatalogBrowseProduct,
} from "./catalog-display";

const base = (patch: Partial<CatalogBrowseProduct> = {}): CatalogBrowseProduct => ({
  id: "dp-1",
  providerId: "p-demohospa",
  title: "示范产品",
  productType: "data",
  status: "active",
  rightsConfirmed: true,
  recordCount: 12640,
  fhirSchema: null,
  ...patch,
});

test("数据源摘要：ImagingStudy 不得报「未声明」", () => {
  const summary = catalogDataSourceSummary(
    base({ fhirSchema: { resourceType: "ImagingStudy" } }),
  );
  assert.equal(summary.kind, "fhir-resource");
  assert.match(summary.text, /影像/);
  assert.match(summary.text, /ImagingStudy/);
  assert.doesNotMatch(summary.text, /未声明/);
});

test("数据源摘要：其它 FHIR 资源保留类型名；CDM 显示 label", () => {
  assert.equal(
    catalogDataSourceSummary(base({ fhirSchema: { resourceType: "Observation" } })).text,
    "观察记录 · Observation",
  );
  assert.equal(
    catalogDataSourceSummary(
      base({ fhirSchema: { dataSource: { type: "omop-cdm", label: "ckd" } } }),
    ).text,
    "OMOP CDM · ckd",
  );
});

test("数据源摘要：服务、文件类与真正未声明可区分", () => {
  assert.equal(
    catalogDataSourceSummary(
      base({ productType: "service", serviceSpec: { statistic: "患病率" } }),
    ).text,
    "数据服务 · 患病率",
  );
  assert.equal(
    catalogDataSourceSummary(
      base({ fhirSchema: { dataSource: { type: "file", path: "data/x" } } }),
    ).text,
    "本地文件 · data/x",
  );
  assert.match(
    catalogDataSourceSummary(base({ fhirSchema: { dataSource: { type: "series-file", path: "raw/y", schema: "cim" } } })).text,
    /时序文件 · raw\/y · cim/,
  );
  const undeclared = catalogDataSourceSummary(base());
  assert.equal(undeclared.kind, "undeclared");
  assert.match(undeclared.text, /未声明/);
});

test("分级：结构化标签优先，自由文本兜底，缺失返回 null", () => {
  assert.equal(
    catalogClassificationLabel(
      base({ classificationTag: { level: "2", categoryCode: "IMPORTANT" } }),
    ),
    "二级 · 重要数据",
  );
  assert.equal(
    catalogClassificationLabel(
      base({ classificationTag: { level: "3", categoryCode: "IMAGING" } }),
    ),
    "三级 · 影像数据",
  );
  assert.equal(
    catalogClassificationLabel(base({ classification: "二级 · 重要数据" })),
    "二级 · 重要数据",
  );
  assert.equal(catalogClassificationLabel(base()), null);
});

test("规模：普通产品带「行」、服务带「容量」、CDM 用人数量级", () => {
  assert.equal(catalogScaleLabel(base({ recordCount: 12640 })), "12,640 行");
  assert.equal(
    catalogScaleLabel(base({ productType: "service", serviceCapacity: 500, recordCount: 9 })),
    "容量 500",
  );
  assert.equal(
    catalogScaleLabel(
      base({
        coverage: {
          label: "ckd",
          cdmVersion: null,
          vocabularyVersion: null,
          tables: [{ table: "person", magnitude: 4 }],
          timeSpan: null,
          computedAt: null,
          reportedAt: "2026-01-01T00:00:00Z",
          stale: false,
          staleReason: null,
        },
      }),
    ),
    "数万人",
  );
});

test("状态与上架范围：英文码映射为可读标签，未知码原样", () => {
  assert.equal(catalogStatusLabel("active"), "在架");
  assert.equal(catalogStatusLabel("archived"), "已下架");
  assert.equal(catalogStatusLabel("weird"), "weird");
  assert.equal(catalogListingScopeLabel("internal"), "本空间");
  assert.equal(catalogListingScopeLabel("regional"), "跨空间（对外在架）");
  assert.equal(catalogListingScopeLabel(undefined), "本空间");
});

test("提供方显示名：登记名 → 兜底解析 → 演示名表 → id", () => {
  assert.equal(
    catalogProviderName(base({ providerDisplayName: "登记机构" }), () => "兜底"),
    "登记机构",
  );
  assert.equal(
    catalogProviderName(base({ providerId: "p-x" }), () => "兜底"),
    "兜底",
  );
  assert.equal(catalogProviderName(base({ providerId: "p-demohospa" })), "示范甲医院");
  assert.equal(catalogProviderName(base({ providerId: "p-unknown" })), "p-unknown");
});

test("列表标识：UUID 只留短提示，短 id 原样，完整 id 留给详情", () => {
  assert.equal(
    catalogIdHint("3f1c9a2e-7b44-4c1e-9f00-112233445566"),
    "#3f1c9a2e",
  );
  assert.equal(catalogIdHint("dp-insulin-panc-demohospa"), "dp-insulin-panc-demohospa");
  assert.equal(catalogIdHint(""), null);
});

test("时间：本地可读格式；非法/缺失返回 null", () => {
  assert.match(formatCatalogTime("2026-11-13T08:05:00.000Z") ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatCatalogTime("nope"), null);
  assert.equal(formatCatalogTime(null), null);
});

test("字段契约行：只接受对象数组，非数组返回空", () => {
  assert.deepEqual(
    catalogFieldRows(
      base({
        fhirSchema: {
          fields: [{ name: "subjectKey", type: "string", description: "主体键" }],
        },
      }),
    ),
    [{ name: "subjectKey", type: "string", description: "主体键" }],
  );
  assert.deepEqual(catalogFieldRows(base({ fhirSchema: { fields: "nope" } })), []);
});
