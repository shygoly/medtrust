import { MdopError } from "../errors";
import {
  assertCollateralFresh,
  createAttestationVerifier,
  createHardwareAttestationVerifier,
  evaluateCollateralFreshness,
  mapVendorQuote,
  parseAttestationReport,
  type AttestationCollateral,
  type AttestationReport,
  type CollateralPolicy,
  type TrustedRootWithCollateral,
} from "./provider";

/**
 * collateral 新鲜度（试点 design P4 残余项 ① / D-TEE-3）。
 *
 * 要证明的判据只有一句：**气隙院内网络下，「用预取的材料离线验 quote」必须带材料时效**——
 * 缺料、过期、超出离线刷新窗口、时间倒挂，四种情形都 MUST 拒（fail-closed）。
 */

const NOW = new Date("2026-09-26T10:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const minutesLater = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();
const DIGEST = `sm3:${"a".repeat(64)}`;

const fresh = (kind: AttestationCollateral["kind"], fetchedMinutesAgo = 30): AttestationCollateral => ({
  kind,
  digest: DIGEST,
  fetched_at: minutesAgo(fetchedMinutesAgo),
  next_update: minutesLater(24 * 60),
});

/** 部署侧策略：TDX 这条链要求吊销清单与校验库，离线刷新窗口 1 天。 */
const POLICY: CollateralPolicy = { required: ["crl", "qvl"], max_staleness_minutes: 24 * 60 };

function tdxReport(collateral?: AttestationCollateral[]): AttestationReport {
  return mapVendorQuote({
    vendor: "tdx",
    measurement: `sm3:${"b".repeat(64)}`,
    tcb: "3.1.2",
    quote: "dGR4LXF1b3Rl",
    signed_at: minutesAgo(1),
    valid_until: minutesLater(10),
    ephemeral_public_key: "04" + "7".repeat(128),
    node: "urn:tds:sh-med:participant:tee-1",
    ...(collateral ? { collateral } : {}),
  });
}

const rootWith = (collateral: CollateralPolicy): TrustedRootWithCollateral => ({
  kind: "tdx",
  collateral,
  verifyQuoteDigest: (digest, report) => digest === report.quote_digest,
});

describe("collateral 新鲜度：预取材料的时效是离线校验的一半", () => {
  it("材料齐全且新鲜 → 通过", () => {
    expect(
      evaluateCollateralFreshness({
        collateral: [fresh("crl"), fresh("qvl")],
        policy: POLICY,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("缺策略要求的材料 → 拒（不退化成「有几样算几样」）", () => {
    const result = evaluateCollateralFreshness({ collateral: [fresh("crl")], policy: POLICY, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("qvl");
    // 一份都没带也一样（真实硬件实现未接 collateral 时的真实情形）
    expect(evaluateCollateralFreshness({ collateral: undefined, policy: POLICY, now: NOW }).ok).toBe(false);
  });

  it("材料自身已过期 → 拒（即使还在刷新窗口内）", () => {
    const expired: AttestationCollateral = {
      kind: "crl",
      digest: DIGEST,
      fetched_at: minutesAgo(10),
      next_update: minutesAgo(1), // 已过有效期
    };
    const result = evaluateCollateralFreshness({
      collateral: [expired, fresh("qvl")],
      policy: POLICY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("已过期");
  });

  it("超出离线刷新窗口 → 拒（气隙环境的刷新必须真的发生）", () => {
    const stale = fresh("crl", 25 * 60); // 取回 25 小时前，窗口 24 小时
    const result = evaluateCollateralFreshness({
      collateral: [stale, fresh("qvl")],
      policy: POLICY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("离线刷新窗口");
  });

  it("时间倒挂（取回时间在未来）或时间字段非法 → 拒", () => {
    const fromFuture = { ...fresh("crl"), fetched_at: minutesLater(5) };
    expect(
      evaluateCollateralFreshness({
        collateral: [fromFuture, fresh("qvl")],
        policy: POLICY,
        now: NOW,
      }).ok,
    ).toBe(false);
    const broken = { ...fresh("crl"), next_update: "not-a-time" };
    expect(
      evaluateCollateralFreshness({ collateral: [broken, fresh("qvl")], policy: POLICY, now: NOW }).ok,
    ).toBe(false);
  });

  it("抛错版给出精确错误码与理由（拒绝只回错误码 + 一句说明）", () => {
    try {
      assertCollateralFresh({
        collateral: [fresh("crl")],
        policy: POLICY,
        now: NOW,
        where: { node: "urn:tds:sh-med:participant:tee-1" },
      });
      throw new Error("应当抛出");
    } catch (err) {
      expect(err).toBeInstanceOf(MdopError);
      expect((err as MdopError).code).toBe("E_ATTESTATION_FAILED");
      expect((err as MdopError).message).toContain("qvl");
    }
  });

  it("真实部署的校验器：必须带 collateral 策略，装配出来即强制时效", () => {
    const verifier = createHardwareAttestationVerifier([rootWith(POLICY)], () => NOW);
    // ① 新鲜材料 → 验得过
    expect(verifier.verify(tdxReport([fresh("crl"), fresh("qvl")]))).toBe(true);
    // ② 未接 collateral（真实代理还没实现取料时的状态）→ 验不过
    expect(verifier.verify(tdxReport())).toBe(false);
    // ③ 料过期 → 验不过
    const expired: AttestationCollateral = {
      kind: "crl",
      digest: DIGEST,
      fetched_at: minutesAgo(10),
      next_update: minutesAgo(1),
    };
    expect(verifier.verify(tdxReport([expired, fresh("qvl")]))).toBe(false);
    // ④ 对照：开发替身校验器（不看材料）对同一份「缺料」报告会放过 —— 这正是两者不能互换的原因
    expect(createAttestationVerifier([rootWith(POLICY)]).verify(tdxReport())).toBe(true);
  });

  it("跨网络收来的报告：collateral 走严格解析（未知种类 / 缺字段 / 摘要形状非法一律拒）", () => {
    const base = tdxReport([fresh("crl"), fresh("qvl")]);
    expect(parseAttestationReport(JSON.parse(JSON.stringify(base)))).toEqual(base);

    const unknownKind = { ...base, collateral: [{ ...fresh("crl"), kind: "made-up" }] };
    expect(() => parseAttestationReport(unknownKind)).toThrow(/collateral\[0\]/);

    const missingField = {
      ...base,
      collateral: [{ kind: "crl", digest: DIGEST, fetched_at: minutesAgo(1) }],
    };
    expect(() => parseAttestationReport(missingField)).toThrow(/next_update/);

    const badDigest = { ...base, collateral: [{ ...fresh("crl"), digest: "sm3:short" }] };
    expect(() => parseAttestationReport(badDigest)).toThrow(/digest/);

    const extraField = { ...base, collateral: [{ ...fresh("crl"), note: "x" }] };
    expect(() => parseAttestationReport(extraField)).toThrow(/未定义字段/);
  });

  it("软件替身的报告不带 collateral，且因此过不了任何硬件校验路径", () => {
    const verifier = createHardwareAttestationVerifier([rootWith(POLICY)], () => NOW);
    const software: AttestationReport = {
      kind: null,
      level: "software",
      isolation: "none",
      measurement: `sm3:${"c".repeat(64)}`,
      quote_digest: null,
      tcb: null,
      ephemeral_public_key: null,
      issued_at: minutesAgo(1),
      expires_at: minutesLater(10),
    };
    expect(software.collateral).toBeUndefined();
    expect(verifier.verify(software)).toBe(false);
  });
});
