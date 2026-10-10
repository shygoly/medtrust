import { Logger } from "@nestjs/common";
import {
  MetaInputRejected,
  derSimonianLaird,
  validateSiteEffects,
  type SiteEffectEstimate,
} from "./meta-analysis";
import { MetaAnalysisService } from "./meta-analysis.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

describe("validateSiteEffects", () => {
  it("accepts valid site-level effects", () => {
    const sites = validateSiteEffects([
      { siteId: "p-demohospa", effect: 0.6, standardError: 0.2 },
      { siteId: "p-demohospb", effect: 0.4, standardError: 0.25 },
    ]);
    expect(sites).toHaveLength(2);
    expect(sites[0].siteId).toBe("p-demohospa");
  });

  it("rejects row-level identifiers in input", () => {
    expect(() =>
      validateSiteEffects([
        {
          siteId: "p-demohospa",
          effect: 0.5,
          standardError: 0.1,
          subjectKey: "sk_1",
        },
        { siteId: "p-demohospb", effect: 0.4, standardError: 0.2 },
      ]),
    ).toThrow(MetaInputRejected);
  });

  it("rejects rows array payload", () => {
    expect(() =>
      validateSiteEffects({
        rows: [{ subjectKey: "x", effect: 1 }],
      }),
    ).toThrow(MetaInputRejected);
  });
});

describe("derSimonianLaird", () => {
  const twoSites: SiteEffectEstimate[] = [
    { siteId: "s1", effect: 0.6, standardError: 0.2 },
    { siteId: "s2", effect: 0.4, standardError: 0.2 },
  ];

  it("pools two homogeneous sites to the arithmetic mean", () => {
    const r = derSimonianLaird(twoSites);
    expect(r.k).toBe(2);
    expect(r.pooledEffect).toBeCloseTo(0.5, 6);
    expect(r.heterogeneity.tau2).toBeCloseTo(0, 6);
    expect(r.forest).toHaveLength(2);
    expect(r.forest[0].weightPercent + r.forest[1].weightPercent).toBeCloseTo(
      100,
      0,
    );
  });

  it("returns forest plot entries with CIs", () => {
    const r = derSimonianLaird(twoSites);
    for (const f of r.forest) {
      expect(f.ci95[0]).toBeLessThan(f.effect);
      expect(f.ci95[1]).toBeGreaterThan(f.effect);
    }
  });

  it("rejects single site", () => {
    expect(() =>
      derSimonianLaird([{ siteId: "only", effect: 0.3, standardError: 0.1 }]),
    ).toThrow(MetaInputRejected);
  });

  it("computes I² in [0, 100]", () => {
    const r = derSimonianLaird([
      { siteId: "a", effect: 0.9, standardError: 0.15 },
      { siteId: "b", effect: 0.1, standardError: 0.15 },
      { siteId: "c", effect: 0.5, standardError: 0.15 },
    ]);
    expect(r.heterogeneity.i2Percent).toBeGreaterThanOrEqual(0);
    expect(r.heterogeneity.i2Percent).toBeLessThanOrEqual(100);
    expect(r.heterogeneity.q).toBeGreaterThan(0);
  });
});

describe("MetaAnalysisService", () => {
  const svc = new MetaAnalysisService(
    new GMCryptoService(),
    new AttestationService(new GMCryptoService()),
  );

  it("returns skip reason for single site without attestation", async () => {
    const out = await svc.mergeSiteEffects([
      { siteId: "p-demohospa", effect: 0.5, standardError: 0.2 },
    ]);
    expect(out.merged).toBe(false);
    if (out.merged === false) expect(out.code).toBe("single_site");
  });

  it("logs audit event and rethrows on row-level input", async () => {
    const warn = jest.spyOn(
      (svc as unknown as { logger: Logger }).logger,
      "warn",
    );
    await expect(
      svc.mergeSiteEffects([
        {
          siteId: "p-demohospa",
          effect: 0.5,
          standardError: 0.1,
          subjectKey: "x",
        },
        { siteId: "p-demohospb", effect: 0.4, standardError: 0.2 },
      ]),
    ).rejects.toThrow(MetaInputRejected);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("meta_input_rejected"),
    );
    warn.mockRestore();
  });

  it("merges ≥2 sites and anchors result hash on chain", async () => {
    const out = await svc.mergeSiteEffects(
      [
        { siteId: "p-demohospa", effect: 0.6, standardError: 0.2 },
        { siteId: "p-demohospb", effect: 0.4, standardError: 0.25 },
      ],
      "rws-meta-1",
    );
    expect(out.merged).toBe(true);
    if (out.merged) {
      expect(out.result.pooledEffect).toBeCloseTo(0.5, 1);
      expect(out.inputFingerprint).toMatch(/^SM3:/);
      expect(out.resultHash).toMatch(/^SM3:/);
      expect(out.attestation.txHash).toMatch(/^0x/);
      expect(out.attestation.hash).toBe(out.resultHash);
    }
  });
});
