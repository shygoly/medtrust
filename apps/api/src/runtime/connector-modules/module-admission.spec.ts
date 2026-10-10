// third-party-module-admission —— 控制面准入五道闸的流转与 fail-closed（tasks 1.x / 4.x / 5.x / 6.1）。
//
// 用真实的 CaService（真 SM2 签名）+ 可注入的构建器：构建器模拟「另起进程跑
// 锁定工具链」的结果，闸 2 的**真实复现构建**由 packages/wasm-algorithms 的
// scripts/admission.test.mjs 覆盖（那里真的跑两遍 cargo 对拍 SM3）。
import { BadRequestException } from "@nestjs/common";
import { sm2Verify } from "@medtrust/mdop";
import {
  CaKeypair,
  Certificate,
  ModuleAdmissionEntity,
  ModuleRevocationEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  CaService,
  moduleSignaturePayload,
} from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { buildFixtureWasm } from "@medtrust/wasm-algorithms";
import {
  ModuleAdmissionService,
  type ModuleBuilder,
  type ReproducibleBuildResult,
} from "./module-admission.service";

const SM3 = "91359f791a853fed6618213ca097ad9edd28d851e23b0378debbd201c9989978";

function okBuild(over: Partial<ReproducibleBuildResult> = {}) {
  return {
    ok: true,
    sm3: SM3,
    sizeBytes: 481,
    language: "rust" as const,
    toolchain: { language: "rust", channel: "1.95.0" },
    staticGate: { byteLength: 481, abiVersionExportKind: "function" },
    reproducibleBuildRef: `repro:rust:1.95.0:${SM3}`,
    ...over,
  };
}

function builderOf(result: ReproducibleBuildResult): ModuleBuilder {
  return { build: async () => result };
}

describe("ModuleAdmissionService —— 五道闸流转", () => {
  let admissions: ReturnType<typeof mockRepo<ModuleAdmissionEntity>>;
  let revocations: ReturnType<typeof mockRepo<ModuleRevocationEntity>>;
  let ca: CaService;
  let service: ModuleAdmissionService;

  const SUBMIT = {
    analysisType: "disproportionality",
    tier: "B" as const,
    language: "rust" as const,
    submittedBy: "pharma-acme",
    sourceRef: "s3://nda-review/acme/disproportionality@v1",
    confidential: true,
  };

  beforeEach(async () => {
    admissions = mockRepo<ModuleAdmissionEntity>();
    revocations = mockRepo<ModuleRevocationEntity>();
    const gm = new GMCryptoService();
    ca = new CaService(
      gm,
      mockRepo<CaKeypair>(),
      mockRepo<Certificate>(),
      "sh-med",
    );
    await ca.onModuleInit();
    service = new ModuleAdmissionService(admissions, revocations, ca, gm);
    service.useBuilder(builderOf(okBuild()));
    process.env.MODULE_LOCAL_BUILD_ALLOWED = "true"; // 本地构建路径的用例需要
  });

  afterEach(() => {
    delete process.env.MODULE_LOCAL_BUILD_ALLOWED;
  });

  // ── 提交（语言白名单 / 层级 / 源码引用）──────────────────────────────

  it("只收 Rust / AssemblyScript 源码；其它语言在提交环节即拒 (task 1.4)", async () => {
    await expect(
      service.submit({ ...SUBMIT, language: "python" as never }),
    ).rejects.toThrow(/只支持 Rust \/ AssemblyScript/);
    await expect(
      service.submit({ ...SUBMIT, language: "wasm" as never }),
    ).rejects.toThrow(BadRequestException);
  });

  it("不设 Tier C：只允许 A / B", async () => {
    await expect(
      service.submit({ ...SUBMIT, tier: "C" as never }),
    ).rejects.toThrow(/不设 Tier C/);
  });

  it("没有源码引用 → 拒（只交二进制复现不出 SM3）", async () => {
    await expect(
      service.submit({ ...SUBMIT, sourceRef: "  " }),
    ).rejects.toThrow(/只交二进制/);
  });

  // ── 闸 2：复现构建 + 平台 SM2 签名 ──────────────────────────────────

  it("复现构建成功 → built，并带平台 CA 对 SM3 的真实 SM2 签名 (task 1.3)", async () => {
    const row = await service.submit(SUBMIT);
    const built = await service.triggerBuild(row.admissionId, "reviewer-zhang");
    expect(built.status).toBe("built");
    expect(built.sm3).toBe(SM3);
    expect(built.reproducibleBuildRef).toContain(SM3);

    const review = built.review as Record<string, unknown>;
    expect(review.reviewer).toBe("reviewer-zhang");
    expect(review.confidential).toBe(true);
    // 签名是真的：用 CA 公钥能验过同一条载荷。
    expect(
      sm2Verify(
        moduleSignaturePayload(SM3),
        review.signature as string,
        // 模块签名只由注册中心密钥签（P-CTL-6 专用算法签名密钥）。
        ca.registryPublicKey,
      ),
    ).toBe(true);
  });

  it("两个构建器 SM3 不一致 → rejected，不予签名 (task 1.2)", async () => {
    service.useBuilder(
      builderOf({
        ok: false,
        reason: "not-reproducible",
        error: "两个独立构建器 SM3 不一致",
      }),
    );
    const row = await service.submit(SUBMIT);
    const out = await service.triggerBuild(row.admissionId, "reviewer-zhang");
    expect(out.status).toBe("rejected");
    expect(out.rejectionReason).toMatch(/not-reproducible/);
    expect(out.sm3).toBeFalsy();
    expect(out.review).toBeFalsy();
  });

  it("静态白名单不过（闸 1 在构建阶段就挡）→ rejected", async () => {
    service.useBuilder(
      builderOf({
        ok: false,
        reason: "illegal-import",
        error:
          "模块含非白名单导入（只允许 env.memory）：wasi_snapshot_preview1.fd_write",
      }),
    );
    const row = await service.submit(SUBMIT);
    const out = await service.triggerBuild(row.admissionId, "r");
    expect(out.status).toBe("rejected");
    expect(out.rejectionReason).toMatch(/wasi/i);
  });

  // ── 闸 3 / 闸 4：不得跳闸 ───────────────────────────────────────────

  it("动态测试任一子项不过 → rejected（闸 3）", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "r");
    const out = await service.recordDynamicGate(row.admissionId, {
      consistency: true,
      determinism: true,
      resourceLimits: true,
      antiExfiltration: false, // 防外泄探针命中
      fuzz: true,
    });
    expect(out.status).toBe("rejected");
    expect(out.rejectionReason).toMatch(/antiExfiltration/);
  });

  it("不得跳闸：built 不能直接全量", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "r");
    await expect(service.promoteToActive(row.admissionId)).rejects.toThrow(
      /不得直接全量/,
    );
    await expect(
      service.startShadow(row.admissionId, { providerId: "p-demohospa" }),
    ).rejects.toThrow(/不得跳闸/);
  });

  it("影子模式结论不干净 → 不晋级，直接 rejected（闸 4）", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "r");
    await service.recordDynamicGate(row.admissionId, {
      consistency: true,
      determinism: true,
      resourceLimits: true,
      antiExfiltration: true,
      fuzz: true,
    });
    await service.startShadow(row.admissionId, { providerId: "p-demohospa" });
    const out = await service.concludeShadow(row.admissionId, {
      clean: false,
      reviewedBy: "dpo-demohospa",
      detail: "与参考实现在真实数据上不一致",
    });
    expect(out.status).toBe("rejected");
    expect((out.shadow as Record<string, unknown>).clean).toBe(false);
    expect(out.rejectionReason).toMatch(/不予晋级/);
  });

  it("全流程正路：submitted → built → tested → shadow → canary → active (task 8.2)", async () => {
    const row = await service.submit(SUBMIT);
    expect(row.status).toBe("submitted");
    expect((await service.triggerBuild(row.admissionId, "r")).status).toBe(
      "built",
    );
    expect(
      (
        await service.recordDynamicGate(row.admissionId, {
          consistency: true,
          determinism: true,
          resourceLimits: true,
          antiExfiltration: true,
          fuzz: true,
        })
      ).status,
    ).toBe("tested");
    expect(
      (await service.startShadow(row.admissionId, { providerId: "p-demohospa" }))
        .status,
    ).toBe("shadow");
    expect(
      (
        await service.concludeShadow(row.admissionId, {
          clean: true,
          reviewedBy: "dpo-demohospa",
        })
      ).status,
    ).toBe("canary");
    expect((await service.promoteToActive(row.admissionId)).status).toBe(
      "active",
    );
  });

  // ── 闸 5：吊销 ─────────────────────────────────────────────────────

  it("吊销 → 名单版本递增，准入记录同步置 revoked (task 5.4)", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "r");

    expect((await service.revocationList()).version).toBe(0);
    await service.revoke(SM3, {
      reason: "security-incident",
      revokedBy: "platform-review",
      detail: "上游依赖爆 CVE",
    });

    const list = await service.revocationList();
    expect(list.version).toBe(1);
    expect(list.revoked.map((r) => r.sm3)).toEqual([SM3]);
    expect(await service.isRevoked(SM3)).toBe(true);
    expect((await service.get(row.admissionId)).status).toBe("revoked");
  });

  it("吊销要求合法 SM3", async () => {
    await expect(
      service.revoke("not-a-hash", { reason: "other", revokedBy: "x" }),
    ).rejects.toThrow(/64 hex/);
  });

  it("已吊销是终态：不得再晋级", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "r");
    await service.revoke(SM3, { reason: "other", revokedBy: "x" });
    await expect(
      service.recordDynamicGate(row.admissionId, {
        consistency: true,
        determinism: true,
        resourceLimits: true,
        antiExfiltration: true,
        fuzz: true,
      }),
    ).rejects.toThrow(/只有 built 状态/);
  });

  // ── 保密审查通道（design D6 / task 1.5）─────────────────────────────

  it("对医院公开的视图只有 SM3 + 层级 + 审查背书，源码引用不外发", async () => {
    const row = await service.submit(SUBMIT);
    await service.triggerBuild(row.admissionId, "reviewer-zhang");
    const view = await service.publicView(SM3);
    expect(view).toBeTruthy();
    expect(view!.sm3).toBe(SM3);
    expect(view!.tier).toBe("B");
    expect(view!.confidential).toBe(true);
    expect((view!.review as Record<string, unknown>).reviewer).toBe(
      "reviewer-zhang",
    );
    // 源码引用绝不在公开视图里。
    expect(JSON.stringify(view)).not.toContain("s3://nda-review");
  });

  it("未入册的 SM3 没有公开视图", async () => {
    expect(await service.publicView("a".repeat(64))).toBeNull();
  });

  // ── 信任边界：控制面不编译，但所有判定自己做 ──────────────────────────

  describe("attestBuild —— 生产路径（api 自算 SM3、自比对、自过闸 1）", () => {
    /** 真实的最小合法模块字节（过得了闸 1）。 */
    const wasm = Buffer.from(buildFixtureWasm({ memoryMax: 1024 }));
    const b64 = wasm.toString("base64");
    const realSm3 = new GMCryptoService().sm3HashBytes(new Uint8Array(wasm));

    const build = (builderId: string, base64 = b64) => ({
      builderId,
      wasmBase64: base64,
      toolchain: {
        language: "rust",
        channel: "1.95.0",
        isolation: "container",
      },
    });

    it("两份独立产物字节一致 → 入册，SM3 是 api 自己算的", async () => {
      const row = await service.submit(SUBMIT);
      const out = await service.attestBuild(row.admissionId, "reviewer-zhang", [
        build("builder-a"),
        build("builder-b"),
      ]);
      expect(out.status).toBe("built");
      expect(out.sm3).toBe(realSm3);
      expect(out.sizeBytes).toBe(wasm.length);
      expect(out.reproducibleBuildRef).toContain("builder-a+builder-b");
      // 签名是真的
      const review = out.review as Record<string, unknown>;
      expect(
        sm2Verify(
          moduleSignaturePayload(realSm3),
          review.signature as string,
          ca.registryPublicKey,
        ),
      ).toBe(true);
    });

    it("提交方谎报 SM3 无效 —— api 只认自己算的", async () => {
      const row = await service.submit(SUBMIT);
      const out = await service.attestBuild(row.admissionId, "r", [
        { ...build("builder-a"), toolchain: { sm3: "deadbeef".repeat(8) } },
        build("builder-b"),
      ]);
      expect(out.sm3).toBe(realSm3);
      expect(out.sm3).not.toContain("deadbeef");
    });

    it("两份产物字节不同 → 不可复现，rejected 且不签名", async () => {
      const other = Buffer.from(
        buildFixtureWasm({ memoryMax: 512, exportMemory: true }),
      ).toString("base64");
      const row = await service.submit(SUBMIT);
      const out = await service.attestBuild(row.admissionId, "r", [
        build("builder-a"),
        build("builder-b", other),
      ]);
      expect(out.status).toBe("rejected");
      expect(out.rejectionReason).toMatch(/不可复现构建/);
      expect(out.review).toBeFalsy();
    });

    it("只交一份 → 拒（一份无法证明可复现）", async () => {
      const row = await service.submit(SUBMIT);
      await expect(
        service.attestBuild(row.admissionId, "r", [build("builder-a")]),
      ).rejects.toThrow(/至少两份/);
    });

    it("同一构建器交两遍 → 拒（不构成复现）", async () => {
      const row = await service.submit(SUBMIT);
      await expect(
        service.attestBuild(row.admissionId, "r", [
          build("builder-a"),
          build("builder-a"),
        ]),
      ).rejects.toThrow(/互不相同\*\*的 builderId/);
    });

    it("产物过不了闸 1（含 WASI 导入）→ rejected", async () => {
      const bad = Buffer.from(
        buildFixtureWasm({ importWasi: "fd_write" }),
      ).toString("base64");
      const row = await service.submit(SUBMIT);
      const out = await service.attestBuild(row.admissionId, "r", [
        build("builder-a", bad),
        build("builder-b", bad),
      ]);
      expect(out.status).toBe("rejected");
      expect(out.rejectionReason).toMatch(/闸 1 静态白名单未通过/);
    });

    it("空产物 → rejected", async () => {
      const row = await service.submit(SUBMIT);
      const out = await service.attestBuild(row.admissionId, "r", [
        build("builder-a", ""),
        build("builder-b"),
      ]);
      expect(out.status).toBe("rejected");
      expect(out.rejectionReason).toMatch(/为空/);
    });
  });

  describe("triggerBuild —— 控制面自行编译缺省禁用（信任边界）", () => {
    it("未显式开启时直接拒，并指向生产路径", async () => {
      delete process.env.MODULE_LOCAL_BUILD_ALLOWED;
      const row = await service.submit(SUBMIT);
      await expect(service.triggerBuild(row.admissionId, "r")).rejects.toThrow(
        /控制面不自行编译第三方代码/,
      );
      await expect(service.triggerBuild(row.admissionId, "r")).rejects.toThrow(
        /attest-build/,
      );
    });
  });
});
