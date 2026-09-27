import { MdopError } from "../errors";
import {
  SoftwareAttestationProvider,
  compareTcb,
  createAttestationVerifier,
  mapVendorQuote,
  reportDataBinding,
  mergeAttestationPolicies,
  resolveMeasurementWhitelist,
  verifyAttestationForC2,
  type AttestationReport,
  type TrustedRoot,
  type VendorQuote,
} from "./provider";

const NOW = new Date("2026-09-25T10:00:00.000Z");

/** 一条硬件证明报告（测试用；真实实现由证明代理产出）。 */
function hardwareReport(over: Partial<AttestationReport> = {}): AttestationReport {
  return {
    kind: "tdx",
    level: "hardware",
    isolation: "hardware-enclave",
    measurement: "sm3:" + "a".repeat(64),
    quote_digest: "sm3:" + "b".repeat(64),
    tcb: "2026-06",
    ephemeral_public_key: "04" + "d".repeat(128),
    report_data: reportDataBinding("04" + "d".repeat(128)),
    node: "urn:tds:sh-med:participant:tee-1",
    issued_at: new Date(NOW.getTime() - 60_000).toISOString(),
    expires_at: new Date(NOW.getTime() + 300_000).toISOString(),
    ...over,
  };
}

/** 只认自己覆盖的链，且只认「摘要等于已登记值」——模型化配置侧信任根。 */
function rootFor(kind: TrustedRoot["kind"], expected: string): TrustedRoot {
  return {
    kind,
    verifyQuoteDigest: (digest) => digest === expected,
  };
}

describe("执行环境证明契约（attestation-provider）", () => {
  describe("软件实现不得作为 C2 目标", () => {
    it("软件实现的证明恒为 software / none，且无 quote 与 TCB", async () => {
      const report = await new SoftwareAttestationProvider({
        measurement: "sm3:" + "c".repeat(64),
        now: () => NOW,
      }).prove();

      expect(report.level).toBe("software");
      expect(report.isolation).toBe("none");
      expect(report.kind).toBeNull();
      expect(report.quote_digest).toBeNull();
      expect(report.tcb).toBeNull();
    });

    it("软件级证明作 C2 目标 → E_CAPABILITY_MISMATCH（哪怕政策与信任根都齐全）", async () => {
      const report = await new SoftwareAttestationProvider({
        measurement: "sm3:" + "c".repeat(64),
        now: () => NOW,
      }).prove();
      const verifier = createAttestationVerifier([{ kind: "tdx", verifyQuoteDigest: () => true }]);

      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["csv", "tdx", "sev-snp"] },
          verifier,
          now: NOW,
          where: { edge: "decA->tee", node: "urn:tds:sp:participant:tee-1" },
        }),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });

    it("声明 hardware 但隔离仍是 none → 同样拒绝（防用半吊子声明蒙混）", () => {
      const report = hardwareReport({ isolation: "none" });
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["tdx"] },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });
  });

  describe("硬件证明的判定", () => {
    const policy = { tee: ["tdx"], min_tcb: "2026-01" };

    it("链型、信任根、度量与 TCB 都满足 → 通过", () => {
      const report = hardwareReport();
      expect(() =>
        verifyAttestationForC2({
          report,
          policy,
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).not.toThrow();
    });

    it("合约未允许该链型 → E_CAPABILITY_MISMATCH", () => {
      const report = hardwareReport({ kind: "csv" });
      expect(() =>
        verifyAttestationForC2({
          report,
          policy,
          verifier: createAttestationVerifier([rootFor("csv", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
    });

    it("信任根不覆盖该链 → E_ATTESTATION_FAILED（配置里没有这个根，就不认）", () => {
      const report = hardwareReport();
      expect(() =>
        verifyAttestationForC2({
          report,
          policy,
          verifier: createAttestationVerifier([rootFor("csv", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    });

    it("信任根不来自消息：报告自带「自己的公钥」也不能放行", () => {
      // 攻击面：控制面被攻破后连公钥一起换。校验器只认配置侧根，因此这条必然失败。
      const report = hardwareReport({
        ...({ self_signed_public_key: "04deadbeef" } as unknown as Partial<AttestationReport>),
      });
      const verifier = createAttestationVerifier([
        { kind: "tdx", verifyQuoteDigest: () => false }, // 配置侧的根校验不过
      ]);
      expect(() =>
        verifyAttestationForC2({ report, policy, verifier, now: NOW }),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    });

    it("证明已过期 → E_ATTESTATION_FAILED（每次会话重新证明）", () => {
      const report = hardwareReport({
        issued_at: new Date(NOW.getTime() - 900_000).toISOString(),
        expires_at: new Date(NOW.getTime() - 1).toISOString(),
      });
      expect(() =>
        verifyAttestationForC2({
          report,
          policy,
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    });

    it("度量不在允许清单 → E_MEASUREMENT_NOT_ALLOWED", () => {
      const report = hardwareReport();
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { ...policy, allowed_measurements: ["sm3:" + "9".repeat(64)] },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));
    });

    it("TCB 低于下限 → E_TCB_TOO_OLD；缺 TCB 也拒", () => {
      const old = hardwareReport({ tcb: "2025-01" });
      const verifier = createAttestationVerifier([rootFor("tdx", old.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({ report: old, policy, verifier, now: NOW }),
      ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));

      const missing = hardwareReport({ tcb: null });
      expect(() =>
        verifyAttestationForC2({
          report: missing,
          policy,
          verifier: createAttestationVerifier([rootFor("tdx", missing.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
    });

    it("阈值与该链版本体系不可比 → E_TCB_TOO_OLD（跨链 TCB 不可互比）", () => {
      const report = hardwareReport({ tcb: "3.1.2" }); // TDX 用点分数字
      expect(() =>
        verifyAttestationForC2({
          report,
          // 作者按 CSV 的年月体系写了阈值：对 TDX 无意义，必须 fail-closed
          policy: { tee: ["tdx"], min_tcb: "2026-06" },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
    });

    it("按链给出阈值时，各链用各自的下限判定", () => {
      const report = hardwareReport({ tcb: "3.1.2" });
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["csv", "tdx"], min_tcb: { csv: "2026-06", tdx: "3.1.0" } },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).not.toThrow();

      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["csv", "tdx"], min_tcb: { csv: "2026-06", tdx: "3.2.0" } },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_TCB_TOO_OLD" }));
    });

    it("错误码携带可指明的边/节点（拒绝消息的定位信息）", () => {
      const report = hardwareReport();
      try {
        verifyAttestationForC2({
          report,
          policy: { tee: ["csv"] },
          verifier: createAttestationVerifier([rootFor("tdx", report.quote_digest!)]),
          now: NOW,
          where: { edge: "l15->dec", node: "urn:tds:sp:participant:tee-1" },
        });
        throw new Error("应当抛出");
      } catch (err) {
        expect(err).toBeInstanceOf(MdopError);
        expect((err as MdopError).toRejectReason()).toEqual({
          code: "E_CAPABILITY_MISMATCH",
          message: expect.stringContaining("tee-1"),
          edge: "l15->dec",
        });
      }
    });
  });

  describe("换链不改协议", () => {
    const vendors: VendorQuote[] = [
      {
        vendor: "csv",
        measurement: "sm3:" + "1".repeat(64),
        tcb: "2026-06",
        quote: "Y3N2LXF1b3Rl",
        signed_at: NOW.toISOString(),
        valid_until: new Date(NOW.getTime() + 600_000).toISOString(),
        ephemeral_public_key: "04" + "1".repeat(128),
        report_data: reportDataBinding("04" + "1".repeat(128)),
        node: "urn:tds:sh-med:participant:tee-csv",
      },
      {
        vendor: "tdx",
        measurement: "sm3:" + "2".repeat(64),
        tcb: "3.1.2",
        quote: "dGR4LXF1b3Rl",
        signed_at: NOW.toISOString(),
        valid_until: new Date(NOW.getTime() + 600_000).toISOString(),
        ephemeral_public_key: "04" + "2".repeat(128),
        report_data: reportDataBinding("04" + "2".repeat(128)),
        node: "urn:tds:sh-med:participant:tee-tdx",
      },
      {
        vendor: "sev-snp",
        measurement: "sm3:" + "3".repeat(64),
        tcb: "1.55",
        quote: "c2V2LXF1b3Rl",
        signed_at: NOW.toISOString(),
        valid_until: new Date(NOW.getTime() + 600_000).toISOString(),
        ephemeral_public_key: "04" + "3".repeat(128),
        report_data: reportDataBinding("04" + "3".repeat(128)),
        node: "urn:tds:sh-med:participant:tee-snp",
      },
    ];

    it("三种链的 quote 都能落到同一份证明形态，且关键信息不丢", () => {
      for (const vendor of vendors) {
        const report = mapVendorQuote(vendor);
        expect(report.kind).toBe(vendor.vendor);
        expect(report.level).toBe("hardware");
        expect(report.isolation).toBe("hardware-enclave");
        expect(report.measurement).toBe(vendor.measurement);
        expect(report.tcb).toBe(vendor.tcb);
        expect(report.issued_at).toBe(vendor.signed_at);
        expect(report.expires_at).toBe(vendor.valid_until);
        expect(report.quote_digest).toMatch(/^sm3:[0-9a-f]{64}$/);
      }
    });

    it("同一份原生 quote 的摘要稳定（可用于锚定与独立复核）", () => {
      expect(mapVendorQuote(vendors[0]).quote_digest).toBe(
        mapVendorQuote({ ...vendors[0] }).quote_digest,
      );
    });

    it("映射后的三种链都能通过各自策略的 C2 判定（换链只换 config）", () => {
      for (const vendor of vendors) {
        const report = mapVendorQuote(vendor);
        const verifier = createAttestationVerifier([rootFor(vendor.vendor, report.quote_digest!)]);
        expect(() =>
          verifyAttestationForC2({
            report,
            // 每条链用各自版本体系的下限（不能拿 CSV 的年月去卡 TDX 的点分数字）
            policy: {
              tee: [vendor.vendor],
              min_tcb: { csv: "2026-01", tdx: "3.1.0", "sev-snp": "1.50" },
            },
            verifier,
            now: NOW,
          }),
        ).not.toThrow();
      }
    });

    it("quote 缺度量或原始内容 → 直接拒（不得产生半份证明）", () => {
      expect(() => mapVendorQuote({ ...vendors[0], measurement: "" })).toThrow(
        expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
      );
      expect(() => mapVendorQuote({ ...vendors[0], quote: "" })).toThrow(
        expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
      );
    });

    it("quote 缺一次性公钥或缺身份绑定 → 直接拒（不得产生半份证明）", () => {
      expect(() => mapVendorQuote({ ...vendors[0], ephemeral_public_key: "" })).toThrow(
        expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
      );
      expect(() => mapVendorQuote({ ...vendors[0], node: "" })).toThrow(
        expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
      );
    });

    it("一次性公钥未进 report_data → 直接拒（不得产生半份证明）", () => {
      const key = "04" + "1".repeat(128);
      expect(() =>
        mapVendorQuote({ ...vendors[0], ephemeral_public_key: key, report_data: "" }),
      ).toThrow(
        expect.objectContaining({
          code: "E_ATTESTATION_FAILED",
          message: expect.stringContaining("不得产生半份证明"),
        }),
      );
      const report = hardwareReport({ ephemeral_public_key: key, report_data: null });
      const verifier = createAttestationVerifier([rootFor("tdx", report.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({ report, policy: { tee: ["tdx"] }, verifier, now: NOW }),
      ).toThrow(
        expect.objectContaining({
          code: "E_ATTESTATION_FAILED",
          message: expect.stringContaining("不得产生半份证明"),
        }),
      );
    });

    it("一次性公钥已绑定进 report_data → 映射保留绑定且 C2 判定通过", () => {
      const key = "04" + "1".repeat(128);
      const report_data = reportDataBinding(key);
      const report = mapVendorQuote({ ...vendors[0], ephemeral_public_key: key, report_data });
      expect(report.report_data).toBe(report_data);
      const verifier = createAttestationVerifier([rootFor(report.kind!, report.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: [report.kind!], min_tcb: { csv: "2026-01", tdx: "3.1.0", "sev-snp": "1.50" } },
          verifier,
          now: NOW,
        }),
      ).not.toThrow();
    });

    it("report_data 与公钥派生值不符 → 直接拒（不得产生半份证明）", () => {
      const key = "04" + "1".repeat(128);
      const other = "04" + "2".repeat(128);
      expect(() =>
        mapVendorQuote({ ...vendors[0], ephemeral_public_key: key, report_data: reportDataBinding(other) }),
      ).toThrow(
        expect.objectContaining({
          code: "E_ATTESTATION_FAILED",
          message: expect.stringContaining("不得产生半份证明"),
        }),
      );
      const report = hardwareReport({
        ephemeral_public_key: key,
        report_data: reportDataBinding(other),
      });
      const verifier = createAttestationVerifier([rootFor("tdx", report.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({ report, policy: { tee: ["tdx"] }, verifier, now: NOW }),
      ).toThrow(
        expect.objectContaining({
          code: "E_ATTESTATION_FAILED",
          message: expect.stringContaining("不得产生半份证明"),
        }),
      );
    });

    it("证明报告缺一次性公钥 → 即便验签通过也不得作 C2 目标（密钥无处可释）", () => {
      const report = hardwareReport({ ephemeral_public_key: null });
      const verifier = createAttestationVerifier([rootFor("tdx", report.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({ report, policy: { tee: ["tdx"] }, verifier, now: NOW }),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
    });

    it("给了期望节点就要求身份绑定一致（不得拿别处的证明顶替）", () => {
      const report = hardwareReport();
      const verifier = createAttestationVerifier([rootFor("tdx", report.quote_digest!)]);
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["tdx"] },
          verifier,
          node: "urn:tds:sh-med:participant:tee-2",
          now: NOW,
        }),
      ).toThrow(expect.objectContaining({ code: "E_ATTESTATION_FAILED" }));
      // 一致则放行
      expect(() =>
        verifyAttestationForC2({
          report,
          policy: { tee: ["tdx"] },
          verifier,
          node: report.node!,
          now: NOW,
        }),
      ).not.toThrow();
    });
  });

  describe("多合约合并：取更严的一侧", () => {
    it("链型取交集；交集为空即空清单（判定侧 fail-closed，不做特例）", () => {
      expect(mergeAttestationPolicies({ tee: ["csv", "tdx"] }, { tee: ["tdx"] }).tee).toEqual(["tdx"]);
      expect(mergeAttestationPolicies({ tee: ["csv"] }, { tee: ["tdx"] }).tee).toEqual([]);
    });

    it("度量清单：一侧未给＝该侧不限；两侧都给了取交集", () => {
      const a = "sm3:" + "a".repeat(64);
      const b = "sm3:" + "b".repeat(64);
      expect(
        mergeAttestationPolicies({ tee: ["tdx"], allowed_measurements: [a] }, { tee: ["tdx"] })
          .allowed_measurements,
      ).toEqual([a]);
      expect(
        mergeAttestationPolicies(
          { tee: ["tdx"], allowed_measurements: [a, b] },
          { tee: ["tdx"], allowed_measurements: [b] },
        ).allowed_measurements,
      ).toEqual([b]);
      expect(
        mergeAttestationPolicies(
          { tee: ["tdx"], allowed_measurements: [a] },
          { tee: ["tdx"], allowed_measurements: [b] },
        ).allowed_measurements,
      ).toEqual([]);
    });

    it("TCB 下限逐链取较高；不可比时不做数值猜测", () => {
      const merged = mergeAttestationPolicies(
        { tee: ["csv", "tdx"], min_tcb: { csv: "2026-01", tdx: "3.1.0" } },
        { tee: ["csv", "tdx"], min_tcb: { csv: "2026-06", tdx: "3.0.0" } },
      );
      expect(merged.min_tcb).toEqual({ csv: "2026-06", tdx: "3.1.0" });

      // 跨体系（年月 vs 点分）不可比：保留一侧，不猜大小
      expect(
        mergeAttestationPolicies(
          { tee: ["tdx"], min_tcb: "2026-06" },
          { tee: ["tdx"], min_tcb: "3.1.2" },
        ).min_tcb,
      ).toBe("2026-06");
    });

    it("一侧未给阈值＝该侧不设下限，另一侧保留", () => {
      expect(
        mergeAttestationPolicies({ tee: ["tdx"] }, { tee: ["tdx"], min_tcb: "3.1.2" }).min_tcb,
      ).toBe("3.1.2");
    });
  });

  describe("度量白名单：注册中心是上限，合约只能更严", () => {
    const registry = ["sm3:" + "a".repeat(64), "sm3:" + "b".repeat(64)];

    it("合约未给清单 → 用注册中心白名单", () => {
      expect(resolveMeasurementWhitelist({ registryWhitelist: registry, policy: { tee: ["tdx"] } })).toEqual(
        registry,
      );
    });

    it("合约收窄 → 取交集（合约里超出注册中心的部分不生效）", () => {
      const out = resolveMeasurementWhitelist({
        registryWhitelist: registry,
        policy: { tee: ["tdx"], allowed_measurements: ["sm3:" + "b".repeat(64), "sm3:" + "z".repeat(64)] },
      });
      expect(out).toEqual(["sm3:" + "b".repeat(64)]);
    });

    it("交集为空 → E_MEASUREMENT_NOT_ALLOWED（不得退化成「不限」）", () => {
      expect(() =>
        resolveMeasurementWhitelist({
          registryWhitelist: registry,
          policy: { tee: ["tdx"], allowed_measurements: ["sm3:" + "z".repeat(64)] },
        }),
      ).toThrow(expect.objectContaining({ code: "E_MEASUREMENT_NOT_ALLOWED" }));
    });
  });

  describe("TCB 版本比较", () => {
    it("同一版本体系内可比；跨体系或非法形态返回 null（不可比）", () => {
      expect(compareTcb("2026-06", "2026-01")).toBe(1);
      expect(compareTcb("2026-01", "2026-06")).toBe(-1);
      expect(compareTcb("2026-06", "2026-06")).toBe(0);
      expect(compareTcb("3.1.2", "3.1.10")).toBe(-1);
      expect(compareTcb("1.55", "1.55.0")).toBe(0);
      // 跨体系（年月 vs 点分数字）与非法形态都不可比
      expect(compareTcb("3.1.2", "2026-01")).toBeNull();
      expect(compareTcb("2026-01", "3.1.2")).toBeNull();
      expect(compareTcb("unknown", "2026-01")).toBeNull();
    });
  });
});
