import { SPACE_ID } from "@medtrust/demo-scenario";
import { PortalService } from "./portal.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("公开门户目录", () => {
  it("未携带空间上下文时只返回默认空间的在架产品", async () => {
    const products = mockRepo();
    await products.save({
      id: "dp-med",
      urn: "urn:tds:sh-med:dp-med",
      title: "医疗产品",
      providerId: "p-a",
      productType: "data",
      classification: "一般",
      status: "active",
      homeSpace: SPACE_ID,
      rightsConfirmed: true,
      recordCount: 1,
      createdAt: "2026-01-02",
    });
    await products.save({
      id: "dp-other",
      urn: "urn:tds:other:dp-other",
      title: "其他空间产品",
      providerId: "p-b",
      productType: "data",
      classification: "一般",
      status: "active",
      homeSpace: "other-space",
      rightsConfirmed: false,
      recordCount: 0,
      createdAt: "2026-01-03",
    });
    await products.save({
      id: "dp-unconfirmed",
      urn: "urn:tds:sh-med:dp-unconfirmed",
      title: "未确权",
      providerId: "p-a",
      productType: "data",
      status: "active",
      homeSpace: SPACE_ID,
      rightsConfirmed: false,
      recordCount: 0,
      createdAt: "2026-01-01",
    });
    await products.save({
      id: "dp-archived",
      urn: "urn:tds:sh-med:dp-archived",
      title: "已下架",
      providerId: "p-a",
      productType: "data",
      status: "archived",
      homeSpace: SPACE_ID,
      rightsConfirmed: true,
      recordCount: 1,
      createdAt: "2026-01-04",
    });
    const svc = new PortalService(products, mockRepo());
    const out = await svc.listProducts();
    expect(out.items.map((item) => item.id)).toEqual(["dp-med"]);
  });
});
