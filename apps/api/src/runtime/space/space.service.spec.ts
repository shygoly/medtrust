import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { SpaceService } from "./space.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("SpaceService — 空间基础管理(6.5)", () => {
  let svc: SpaceService;
  beforeEach(() => {
    svc = new SpaceService(mockRepo());
  });

  it("creates and lists a space", async () => {
    const s = await svc.create({ id: "sh-med-2", name: "测试空间" });
    expect(s.id).toBe("sh-med-2");
    expect(s.status).toBe("active");
    expect(await svc.list()).toHaveLength(1);
  });

  it("rejects an empty id", async () => {
    await expect(svc.create({ id: "", name: "x" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects a duplicate id", async () => {
    await svc.create({ id: "sh-med", name: "x" });
    await expect(svc.create({ id: "sh-med", name: "y" })).rejects.toThrow(
      ConflictException,
    );
  });

  it("removes an existing space", async () => {
    await svc.create({ id: "sh-med-3", name: "x" });
    await svc.remove("sh-med-3");
    expect(await svc.get("sh-med-3")).toBeNull();
  });

  it("rejects removing a missing space", async () => {
    await expect(svc.remove("nope")).rejects.toThrow(NotFoundException);
  });

  it("a space carries only metadata (no raw rows)", async () => {
    const s = await svc.create({ id: "sh-med-4", name: "x" });
    expect(Object.keys(s)).not.toContain("rows");
    expect(Object.keys(s)).not.toContain("data");
  });
});
