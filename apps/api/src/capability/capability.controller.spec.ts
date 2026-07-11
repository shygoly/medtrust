import { Test, TestingModule } from "@nestjs/testing";
import { LayerKind } from "@medtrust/database";
import { CapabilityController } from "./capability.controller";
import { CapabilityRegistryService } from "./registry.service";

describe("CapabilityController", () => {
  const svc = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  let ctrl: CapabilityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CapabilityController],
      providers: [{ provide: CapabilityRegistryService, useValue: svc }],
    }).compile();
    ctrl = module.get(CapabilityController);
    jest.clearAllMocks();
  });

  it("GET /capability/:layer delegates to registry.list", async () => {
    svc.list.mockResolvedValue([{ key: "tee-sgx" }]);
    await expect(ctrl.list(LayerKind.L6_PROTOCOL)).resolves.toEqual([
      { key: "tee-sgx" },
    ]);
    expect(svc.list).toHaveBeenCalledWith(LayerKind.L6_PROTOCOL);
  });

  it("GET /capability/:layer/:key delegates to registry.get", async () => {
    svc.get.mockResolvedValue({ key: "tee-sgx" });
    await expect(ctrl.get(LayerKind.L6_PROTOCOL, "tee-sgx")).resolves.toEqual({
      key: "tee-sgx",
    });
    expect(svc.get).toHaveBeenCalledWith(LayerKind.L6_PROTOCOL, "tee-sgx");
  });

  it("POST /capability/:layer delegates to registry.create", async () => {
    const dto = { key: "m", name: "M", category: "LLM" };
    svc.create.mockResolvedValue({ id: "1", ...dto });
    await ctrl.create(LayerKind.L3_MODEL, dto as any);
    expect(svc.create).toHaveBeenCalledWith(LayerKind.L3_MODEL, dto);
  });

  it("PATCH /capability/:layer/:key delegates to registry.update", async () => {
    const dto = { name: "M2" };
    svc.update.mockResolvedValue({ key: "m", name: "M2" });
    await ctrl.update(LayerKind.L3_MODEL, "m", dto as any);
    expect(svc.update).toHaveBeenCalledWith(LayerKind.L3_MODEL, "m", dto);
  });

  it("DELETE /capability/:layer/:key delegates to registry.remove", async () => {
    svc.remove.mockResolvedValue({ deleted: true, key: "m" });
    await ctrl.remove(LayerKind.L3_MODEL, "m");
    expect(svc.remove).toHaveBeenCalledWith(LayerKind.L3_MODEL, "m");
  });
});
