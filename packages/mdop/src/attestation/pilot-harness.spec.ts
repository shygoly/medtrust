import { canonicalSm3 } from "../crypto/sm3";
import { MdopError } from "../errors";
import { anchorChainHead, type ChainAnchorSink } from "../anchor/anchor";
import { parseAnchorRecord } from "../schema/artifact";
import {
  SoftwareAttestationProvider,
  createAttestationVerifier,
  createHardwareAttestationVerifier,
  mapVendorQuote,
  reportDataBinding,
  verifyAttestationForC2,
  type AttestationCollateral,
  type AttestationProvider,
  type AttestationReport,
  type AttestationVerifier,
  type CollateralPolicy,
  type TeeKind,
  type TrustedRoot,
  type TrustedRootWithCollateral,
  type VendorQuote,
} from "./provider";
import { evaluateKeyRelease } from "./release";

/**
 * 试点骨架（不需要硬件）：
 *
 *   持有方封存 → 证明 → 密钥释放判定 → 节点内执行 → 发布审查 → 出口（只出 C3）→ 回执链 → 链头锚定
 *
 * 本文件里的执行器、闸门、回执链都是**测试替身**——它们存在的唯一目的，是验证
 * 「把软件替身换成硬件实现时，**除证明提供者与 KMS 客户端之外不需要改任何调用点**」。
 * 真实实现分别归：`apps/tee-node`（节点侧）、平台 `cp_mdop_attestation` 与回执链服务。
 */

// ── 测试替身 ────────────────────────────────────────────────────────────────

/** 硬件证明代理的替身：按链型产出一份可被配置侧信任根验通的报告。 */
class FakeHardwareProvider implements AttestationProvider {
  constructor(
    readonly providerKind: TeeKind,
    private readonly opts: {
      measurement: string;
      tcb: string;
      now: () => Date;
      quote: string;
      collateral?: AttestationCollateral[];
    },
  ) {}

  async prove(): Promise<AttestationReport> {
    const now = this.opts.now();
    return mapVendorQuote({
      vendor: this.providerKind,
      measurement: this.opts.measurement,
      tcb: this.opts.tcb,
      quote: this.opts.quote,
      signed_at: now.toISOString(),
      valid_until: new Date(now.getTime() + 300_000).toISOString(),
      ephemeral_public_key: "04" + "6".repeat(128),
      report_data: reportDataBinding("04" + "6".repeat(128)),
      node: "urn:tds:sh-med:participant:tee-1",
      ...(this.opts.collateral ? { collateral: this.opts.collateral } : {}),
    });
  }
}

/** 配置侧信任根：只认自己这张表里的 quote 摘要（对照「不得取自消息」）。 */
function configuredRoots(reports: AttestationReport[]): TrustedRoot[] {
  return reports.map((r) => ({
    kind: r.kind!,
    verifyQuoteDigest: (digest) => digest === r.quote_digest,
  }));
}

/** 极简封存：AAD 绑定作业 / 凭证 / 合约，换作业即解不开。 */
function seal(payload: unknown, aad: { job: string; credential: string; contract: string }) {
  return { cipherRef: "blob://pilot/1", aad, plaintext: payload };
}

/** 节点内执行：只认 AAD 匹配的信封（真实实现由节点入口守卫做这件事）。 */
function openSealed(
  sealed: ReturnType<typeof seal>,
  expect_: { job: string; credential: string; contract: string },
): unknown {
  const same =
    sealed.aad.job === expect_.job &&
    sealed.aad.credential === expect_.credential &&
    sealed.aad.contract === expect_.contract;
  if (!same) throw new MdopError("E_ENVELOPE_POLICY", {}, "信封的绑定信息与本作业不符");
  return sealed.plaintext;
}

/** 发布审查替身：小单元格抑制（minCell）。 */
function gate(table: { cells: number[] }, minCell: number): { cells: number[]; suppressed: number } {
  let suppressed = 0;
  const cells = table.cells.map((c) => {
    if (c > 0 && c < minCell) {
      suppressed += 1;
      return 0;
    }
    return c;
  });
  return { cells, suppressed };
}

/** 出口守卫替身：只放 C3。 */
function exit(artifact: { label: string; body: unknown }): { label: "C3"; body: unknown } {
  if (artifact.label !== "C3")
    throw new MdopError("E_LABEL_VIOLATION", {}, `出口只放 C3，收到 ${artifact.label}`);
  return { label: "C3", body: artifact.body };
}

/** 回执链替身：每条回执以上一条的哈希为 prev。 */
class ReceiptChain {
  private prev: string | null = null;
  readonly entries: Array<{ event: string; prev: string | null; hash: string }> = [];

  append(event: string, detail: Record<string, unknown>): string {
    const hash = canonicalSm3({ event, prev: this.prev, detail });
    this.entries.push({ event, prev: this.prev, hash });
    this.prev = hash;
    return hash;
  }

  head(): string | null {
    return this.prev;
  }

  /** 逐条校验连续性；断链返回断点下标。 */
  verify(): { valid: boolean; brokenAt?: number } {
    let prev: string | null = null;
    for (const [i, e] of this.entries.entries()) {
      if (e.prev !== prev) return { valid: false, brokenAt: i };
      prev = e.hash;
    }
    return { valid: true };
  }
}

// ── 管线本体（换实现时**这段代码一行不动**）────────────────────────────────

interface PipelineInput {
  provider: AttestationProvider;
  policy: { tee: string[]; min_tcb?: string | Partial<Record<string, string>> };
  roots: TrustedRoot[];
  job: string;
  credential: string;
  contract: string;
  keyOwner: { job_id: string; contract_id: string };
  credentialValid?: boolean;
  contractActive?: boolean;
  now: () => Date;
  minCell: number;
  table: { cells: number[] };
  /** 存证链写入端；不传 = 未接链（锚定记 pending，进补偿队列）。 */
  sink?: ChainAnchorSink;
}

async function runPilotPipeline(input: PipelineInput) {
  const chain = new ReceiptChain();
  const aad = { job: input.job, credential: input.credential, contract: input.contract };

  // ① 持有方封存（真实实现：seal 算子 + AEAD + 水印 + 持有方签名）
  const sealed = seal(input.table, aad);
  chain.append("SEALED", { cipherRef: sealed.cipherRef });

  // ② 节点证明（真实实现：证明代理对接 DCAP / 厂商证明服务）
  const report: AttestationReport = await input.provider.prove();

  // ③ 密钥释放判定（真实实现：KMS 客户端；判据本身来自 mdop 的 evaluateKeyRelease）
  const decision = evaluateKeyRelease({
    report,
    policy: input.policy,
    verifier: createAttestationVerifier(input.roots),
    job_id: input.job,
    credential_id: input.credential,
    contract_id: input.contract,
    key_id: "k-1",
    key_owner: input.keyOwner,
    credential_valid: input.credentialValid ?? true,
    contract_active: input.contractActive ?? true,
    now: input.now(),
  });
  chain.append("RELEASED", { warrant: decision.warrant_digest });

  // ④ 节点内执行：解封（AAD 校验）→ 算子 → 发布审查
  const payload = openSealed(sealed, aad) as { cells: number[] };
  const released = gate(payload, input.minCell);
  chain.append("EXECUTED", { suppressed: released.suppressed });

  // ⑤ 出口：只出 C3
  const out = exit({ label: "C3", body: released });
  chain.append("EXITED", { label: out.label });

  // ⑥ 链头锚定（真实实现：存证适配器）——链不可达只记 pending，不得伪造交易号
  const head = chain.head();
  if (!head) throw new Error("回执链为空，没有可锚定的链头");
  const anchor = await anchorChainHead({
    job_id: input.job,
    node: "urn:tds:sh-med:participant:tee-1",
    chain_head: head,
    ...(input.sink ? { sink: input.sink } : {}),
    now: input.now,
  });

  return { out, chain, report, decision, anchor };
}

// ── 用例 ───────────────────────────────────────────────────────────────────

describe("试点骨架：封存 → 证明 → 释放 → 执行 → 闸门 → 出口 → 回执链", () => {
  const NOW = new Date("2026-09-25T10:00:00.000Z");
  const now = () => NOW;

  const tdx = new FakeHardwareProvider("tdx", {
    measurement: "sm3:" + "a".repeat(64),
    tcb: "3.1.2",
    now,
    quote: "dGR4LXF1b3Rl",
  });

  async function tdxRoots(): Promise<TrustedRoot[]> {
    return configuredRoots([await tdx.prove()]);
  }

  it("管线跑通：只出 C3，回执链成链并把**这条链的链头**锚进存证链", async () => {
    const anchored: Array<{ job_id: string; node: string; chain_head: string }> = [];
    const { out, chain, anchor } = await runPilotPipeline({
      provider: tdx,
      policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
      roots: await tdxRoots(),
      job: "job-1",
      credential: "tkt-1",
      contract: "ctr-1",
      keyOwner: { job_id: "job-1", contract_id: "ctr-1" },
      now,
      minCell: 5,
      table: { cells: [12, 3, 40, 8] },
      sink: {
        anchor: async (input) => {
          anchored.push(input);
          return { tx_id: "0xchain-1" };
        },
      },
    });

    expect(out.label).toBe("C3");
    expect(out.body).toEqual({ cells: [12, 0, 40, 8], suppressed: 1 });
    expect(chain.verify()).toEqual({ valid: true });
    expect(chain.head()).toMatch(/^sm3:[0-9a-f]{64}$/);
    // 锚的是这条链的链头（不是别的摘要），且记录可被离线读回
    expect(anchored).toEqual([
      { job_id: "job-1", node: "urn:tds:sh-med:participant:tee-1", chain_head: chain.head() },
    ]);
    expect(anchor).toEqual({
      node: "urn:tds:sh-med:participant:tee-1",
      chain_head: chain.head(),
      status: "anchored",
      tx_id: "0xchain-1",
      anchored_at: NOW.toISOString(),
    });
    expect(parseAnchorRecord(JSON.parse(JSON.stringify(anchor)))).toEqual(anchor);
  });

  it("未接存证链：链头仍登记为 pending（进补偿队列），记录里**没有** tx_id", async () => {
    const { chain, anchor } = await runPilotPipeline({
      provider: tdx,
      policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
      roots: await tdxRoots(),
      job: "job-1",
      credential: "tkt-1",
      contract: "ctr-1",
      keyOwner: { job_id: "job-1", contract_id: "ctr-1" },
      now,
      minCell: 5,
      table: { cells: [12, 3] },
    });

    expect(anchor).toEqual({
      node: "urn:tds:sh-med:participant:tee-1",
      chain_head: chain.head(),
      status: "pending",
    });
    expect("tx_id" in anchor).toBe(false);
    // 链本身照旧是可核验的完整链（锚不上不等于作业失败）
    expect(chain.verify()).toEqual({ valid: true });
  });

  it("断链可被检出（回执链不变量）", async () => {
    const { chain } = await runPilotPipeline({
      provider: tdx,
      policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
      roots: await tdxRoots(),
      job: "job-1",
      credential: "tkt-1",
      contract: "ctr-1",
      keyOwner: { job_id: "job-1", contract_id: "ctr-1" },
      now,
      minCell: 5,
      table: { cells: [12, 3] },
    });

    // 篡改第二条的 prev：链断裂必须被发现，且指出位置
    (chain.entries[1] as { prev: string | null }).prev = "sm3:" + "0".repeat(64);
    expect(chain.verify()).toEqual({ valid: false, brokenAt: 1 });
  });

  it("换实现不动调用点：TDX 换 CSV，同一段管线代码照跑（只换提供者与信任根）", async () => {
    const csv = new FakeHardwareProvider("csv", {
      measurement: "sm3:" + "c".repeat(64),
      tcb: "2026-06",
      now,
      quote: "Y3N2LXF1b3Rl",
    });

    const runWith = (
      provider: AttestationProvider,
      roots: TrustedRoot[],
      policyTee: string,
      min: string,
    ) =>
      runPilotPipeline({
        provider,
        policy: { tee: [policyTee], min_tcb: { [policyTee]: min } },
        roots,
        job: "job-9",
        credential: "tkt-9",
        contract: "ctr-9",
        keyOwner: { job_id: "job-9", contract_id: "ctr-9" },
        now,
        minCell: 5,
        table: { cells: [7, 2] },
      });

    const viaTdx = await runWith(tdx, await tdxRoots(), "tdx", "3.1.0");
    const viaCsv = await runWith(csv, configuredRoots([await csv.prove()]), "csv", "2026-01");

    // 结果形状一致（事件序列相同），说明协议与调用点不感知链型
    expect(viaCsv.chain.entries.map((e) => e.event)).toEqual(
      viaTdx.chain.entries.map((e) => e.event),
    );
    expect(viaCsv.out).toEqual(viaTdx.out);
    // 但释放凭据不同：换链条 = 换证明摘要，可被持有方与链上记录区分
    expect(viaCsv.decision.warrant_digest).not.toBe(viaTdx.decision.warrant_digest);
  });

  it("离线校验的硬要求：真实部署校验器必须带 collateral 策略，缺料/过期即拒（KMS 不释放）", async () => {
    const policy: CollateralPolicy = { required: ["crl", "qvl"], max_staleness_minutes: 24 * 60 };
    const minute = 60_000;
    const material = (kind: AttestationCollateral["kind"], fetchedMinutesAgo: number) => ({
      kind,
      digest: `sm3:${kind === "crl" ? "1" : "2"}`.padEnd(68, "0"),
      fetched_at: new Date(NOW.getTime() - fetchedMinutesAgo * minute).toISOString(),
      next_update: new Date(NOW.getTime() + 12 * 60 * minute).toISOString(),
    });
    const hardware = new FakeHardwareProvider("tdx", {
      measurement: "sm3:" + "d".repeat(64),
      tcb: "3.1.2",
      now,
      quote: "dGR4LXF1b3Rl",
      collateral: [material("crl", 30), material("qvl", 30)],
    });
    const noCollateral = new FakeHardwareProvider("tdx", {
      measurement: "sm3:" + "d".repeat(64),
      tcb: "3.1.2",
      now,
      quote: "dGR4LXF1b3Rl",
    });
    const stale = new FakeHardwareProvider("tdx", {
      measurement: "sm3:" + "d".repeat(64),
      tcb: "3.1.2",
      now,
      quote: "dGR4LXF1b3Rl",
      collateral: [material("crl", 25 * 60), material("qvl", 25 * 60)], // 超出 24 小时刷新窗口
    });
    const roots: TrustedRootWithCollateral[] = [
      {
        kind: "tdx",
        collateral: policy,
        verifyQuoteDigest: (digest, report) => digest === report.quote_digest,
      },
    ];
    const releaseWith = (report: AttestationReport, verifier: AttestationVerifier) => () =>
      evaluateKeyRelease({
        report,
        policy: { tee: ["tdx"], min_tcb: { tdx: "3.1.0" } },
        verifier,
        job_id: "job-1",
        credential_id: "tkt-1",
        contract_id: "ctr-1",
        key_id: "k-1",
        key_owner: { job_id: "job-1", contract_id: "ctr-1" },
        credential_valid: true,
        contract_active: true,
        now: NOW,
      });
    const realVerifier = createHardwareAttestationVerifier(roots, now);

    // ① 材料新鲜 → 释放
    expect(releaseWith(await hardware.prove(), realVerifier)().released).toBe(true);
    // ② 未随带材料（真实代理还没实现取料）→ 拒
    expect(releaseWith(await noCollateral.prove(), realVerifier)).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
    // ③ 材料超出离线刷新窗口 → 拒
    expect(releaseWith(await stale.prove(), realVerifier)).toThrow(
      expect.objectContaining({ code: "E_ATTESTATION_FAILED" }),
    );
    // ④ 对照：开发替身校验器不看材料时效，同一份「缺料」报告会被放过 —— 两者不可互换
    expect(
      releaseWith(await noCollateral.prove(), createAttestationVerifier(configuredRoots([
        await noCollateral.prove(),
      ])))().released,
    ).toBe(true);
  });

  it("软件替身进管线：在释放判定处被拒，绝不执行", async () => {
    const software = new SoftwareAttestationProvider({
      measurement: "sm3:" + "s".repeat(64),
      now,
    });
    const roots = configuredRoots([await tdx.prove()]); // 配置侧只配了硬件根

    // 软件替身：调用管线本身（异步）即必须在释放判定处被拒
    await expect(
      runPilotPipeline({
        provider: software,
        policy: { tee: ["csv", "tdx", "sev-snp"] },
        roots,
        job: "job-1",
        credential: "tkt-1",
        contract: "ctr-1",
        keyOwner: { job_id: "job-1", contract_id: "ctr-1" },
        now,
        minCell: 5,
        table: { cells: [9, 9] },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });

  it("出口只放 C3：C0 制品出不去（与编译/复核结论无关）", () => {
    expect(() => exit({ label: "C0", body: { cells: [1] } })).toThrow(
      expect.objectContaining({ code: "E_LABEL_VIOLATION" }),
    );
  });

  it("信封换作业即解不开（AAD 绑定）", () => {
    const sealed = seal({ cells: [1, 2] }, { job: "job-1", credential: "tkt-1", contract: "ctr-1" });
    expect(() =>
      openSealed(sealed, { job: "job-2", credential: "tkt-1", contract: "ctr-1" }),
    ).toThrow(expect.objectContaining({ code: "E_ENVELOPE_POLICY" }));
  });

  it("软件级证明在任何政策下都过不了 C2 判定（三链全开也一样）", async () => {
    const software = await new SoftwareAttestationProvider({
      measurement: "sm3:" + "s".repeat(64),
      now,
    }).prove();
    const roots = configuredRoots([await tdx.prove()]);
    expect(() =>
      verifyAttestationForC2({
        report: software,
        policy: { tee: ["csv", "tdx", "sev-snp"], min_tcb: { csv: "2020-01", tdx: "1.0.0" } },
        verifier: createAttestationVerifier(roots),
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "E_CAPABILITY_MISMATCH" }));
  });
});
