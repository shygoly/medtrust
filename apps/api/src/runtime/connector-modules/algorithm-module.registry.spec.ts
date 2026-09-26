import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sm2Verify } from "@medtrust/mdop";
import { CaKeypair, Certificate } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  CaService,
  moduleSignaturePayload,
} from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { AlgorithmModuleRegistry } from "./algorithm-module.registry";

async function buildRegistry() {
  const gm = new GMCryptoService();
  const ca = new CaService(
    gm,
    mockRepo<CaKeypair>() as never,
    mockRepo<Certificate>() as never,
  );
  await ca.onModuleInit();
  const registry = new AlgorithmModuleRegistry(gm, ca);
  registry.onModuleInit();
  return { gm, ca, registry };
}

describe("AlgorithmModuleRegistry — 模块装载与签名 (5.2/5.3)", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("装载入库产物:SM3 与清单一致、ABI 受支持", async () => {
    const { registry } = await buildRegistry();
    const modules = registry.list();
    expect(modules.length).toBeGreaterThanOrEqual(1);
    const l15 = modules.find((m) => m.analysisType === "disproportionality");
    expect(l15).toBeDefined();
    expect(l15!.sm3).toMatch(/^[0-9a-f]{64}$/);
    expect(l15!.abiVersion).toBe(1);
    expect(registry.has(l15!.sm3)).toBe(true);
    expect(registry.has("0".repeat(64))).toBe(false);
  });

  it("签名是平台 CA 对模块 SM3 的 SM2 签名(连接器同口径可验)", async () => {
    const { ca, registry } = await buildRegistry();
    const sm3 = registry.list()[0].sm3;
    const mod = registry.get(sm3)!;
    expect(mod.signature).toBeTruthy();
    // 与连接器 moduleSignaturePayload 同一串(跨平面契约)
    expect(moduleSignaturePayload(sm3)).toBe(
      `medtrust.algorithm-module.v1:${sm3}`,
    );
    expect(
      sm2Verify(
        moduleSignaturePayload(sm3),
        mod.signature,
        ca.registryPublicKey,
      ),
    ).toBe(true);
    // 换一个 SM3 的载荷验不过(签名与模块一一对应)
    expect(
      sm2Verify(
        moduleSignaturePayload("a".repeat(64)),
        mod.signature,
        ca.registryPublicKey,
      ),
    ).toBe(false);
  });

  it("清单与文件 SM3 不符 → 拒绝分发(fail-closed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "medtrust-modules-"));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "mod.wasm"),
        Buffer.from([0x00, 0x61, 0x73, 0x6d]),
      );
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          modules: [
            {
              analysisType: "disproportionality",
              file: "mod.wasm",
              abiVersion: 1,
              sm3: "b".repeat(64),
            },
          ],
        }),
      );
      process.env.WASM_ALGORITHMS_DIR = dir;
      const { registry } = await buildRegistry();
      expect(registry.list()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
