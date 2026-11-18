import { buildL15Plan } from "@medtrust/domain-med";
import { currentSpaceId } from "../runtime/space-context/space-id.util";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalSm3,
  computePlanHash,
  fragmentHash,
  generateSm2KeyPair,
  holderSignAcceptance,
  parseFragment,
  parseAuditReceipt,
  parseTicketCore,
  participantUrn,
  publicKeyKid,
  publicKeyFromPrivateKey,
  signCanonicalObject,
  verifyTicketForExecution,
  type Fragment,
  type TicketCore,
} from "@medtrust/mdop";
import { GMCryptoService } from "../security/crypto/gm-crypto.service";
import { CaService } from "../runtime/participant-identity/ca.service";
import { mockRepo } from "../runtime/test-utils/mock-repo";
import { MdopContractService } from "../runtime/digital-contract/mdop-contract.service";
import { MdopOperatorRegistryService } from "./operator-registry.service";
import { MdopJobsService } from "./mdop-jobs.service";
import { MdopTicketService } from "./mdop-ticket.service";
import { MdopSchedulerService } from "./mdop-scheduler.service";
import { MdopMergeService } from "./mdop-merge.service";
import { MdopPurgeService } from "./mdop-purge.service";
import { MdopReceiptChainService } from "./mdop-receipt-chain.service";

import { mergeDisproportionalityAggregates } from "../runtime/rws-orchestrator/disproportionality";
import { AlgorithmModuleRegistry } from "../runtime/connector-modules/algorithm-module.registry";

/**
 * §10.10 端到端演练（**协议级、单进程**）：两院 + 平台接收方跑通一个 L1.5 作业。
 *
 * 覆盖的是一条完整链路：
 *   合约持签 → 作业提交 → 编译（数据就近/合并落平台）→ 片段要约 → 两院接受签名 →
 *   平台签发凭证 → 调度 → 两院各自产出 C3 并投递 → 平台收齐合并 → 作业 SUCCEEDED →
 *   销毁编排 → 收齐销毁回执 → PURGED → 审计回执链可离线核验。
 *
 * 如实边界：本用例在同一进程内驱动**协议与平台侧的真实实现**，两个「连接器」按协议
 * （用 packages/mdop 的原语）扮演各院角色；连接器**应用本身**（含真实 wasm 沙箱执行）
 * 由 `apps/connector` 的用例覆盖（§9.7 对拍 + §10 连接器侧一致性测试），三进程实机演练见 §11.5。
 */

const SPACE = "sh-med";
const HOSP_A = "p-demohospa";
const HOSP_B = "p-demohospb";
const NODE_A = participantUrn(SPACE, HOSP_A);
const NODE_B = participantUrn(SPACE, HOSP_B);
const PLATFORM = participantUrn(SPACE, "platform");
const DRUG = "注射用紫杉醇";

describe("§10.10 两院 + 平台接收方的 L1.5 端到端演练", () => {
  const gm = new GMCryptoService();
  const keysA = generateKeys();
  const keysB = generateKeys();
  const platformNodeKeys = generateKeys();

  function generateKeys() {
    return gm.generateSM2KeyPair();
  }

  it("跑通全链路，且凭证与回执链可离线核验", async () => {
    process.env.SPACE_ID = SPACE;
    // ── 平台侧真实实现 ──────────────────────────────────────────────
    const caKeysRepo = mockRepo();
    const contractsRepo = mockRepo();
    const certsRepo = mockRepo();
    const ca = new CaService(gm, caKeysRepo, mockRepo(), SPACE);
    await ca.onModuleInit();
    for (const [keys, id] of [
      [keysA, HOSP_A],
      [keysB, HOSP_B],
    ] as const) {
      await certsRepo.save(
        certsRepo.create({
          sm2Fingerprint: `SM2:${id}`,
          participantId: id,
          connectorId: `c-${id}`,
          spaceId: SPACE,
          subjectPublicKey: keys.publicKey,
          validUntil: new Date("2027-09-24T00:00:00.000Z"),
          revoked: false,
        }),
      );
    }

    const contractsSvc = new MdopContractService(
      gm,
      ca,
      contractsRepo,
      certsRepo,
      mockRepo(),
      SPACE,
    );
    // 每院一份合约：提供方 = 该院，接收方含平台（C3 合并方）
    for (const [id, node] of [
      [HOSP_A, NODE_A],
      [HOSP_B, NODE_B],
    ] as const) {
      await contractsRepo.save(
        contractsRepo.create({
          id: `ctr-${id}`,
          dataProductId: `dp-${id}`,
          providerId: id,
          consumerId: "p-meddata",
          purpose: "RWS.EFFECTIVENESS",
          retention: "阅后即焚",
          output: "仅聚合统计",
          outputPolicy: { preset: "aggregate-only", minCell: 5 },
          validUntil: "2027-09-24T00:00:00.000Z",
          status: "active",
          pinnedModules: {
            disproportionality: { sm3: "b".repeat(64), tier: "A" },
          },
          createdAt: new Date("2026-09-24T00:00:00.000Z"),
          mdopStatus: "unsigned",
        }),
      );
      const offer = await contractsSvc.offer(`ctr-${id}`, {
        extraRecipients: [{ party: node, role: "final", jurisdiction: "CN" }],
      });
      // 各院连接器用本院私钥签 canonical（连接器侧 confirm 的口径）
      const holderSignature = gm.sm2Sign(
        offer.canonical,
        id === HOSP_A ? keysA.privateKey : keysB.privateKey,
      );
      await contractsSvc.agree({
        contractId: `ctr-${id}`,
        canonical: offer.canonical,
        holderSignature,
      });
    }

    // 算子注册中心（含 L1.5 的 wasm 清单与三个 system 机制）
    const operatorRepo = mockRepo();
    const operators = new MdopOperatorRegistryService(
      gm,
      ca,
      operatorRepo,
      mockRepo(),
      {
        list: () => [
          {
            analysisType: "disproportionality",
            file: "disproportionality.wasm",
            abiVersion: 1,
            sm3: "b".repeat(64),
            compiler: { name: "assemblyscript", version: "0.27.37" },
          },
        ],
      } as unknown as AlgorithmModuleRegistry,
    );
    await operators.onModuleInit();

    const jobsRepo = mockRepo();
    const stagesRepo = mockRepo();
    const fragmentsRepo = mockRepo();
    const jobs = new MdopJobsService(
      jobsRepo,
      stagesRepo,
      fragmentsRepo,
      operators,
      contractsSvc,
    );

    // ── 1) 提交 + 编译（数据就近、多院依赖落平台合并）──────────────────
    const plan = buildL15Plan(
      {
        purpose: "RWS.EFFECTIVENESS",
        applicant: { org: "sponsor", project: "t2dm" },
        contracts: [`ctr-${HOSP_A}`, `ctr-${HOSP_B}`],
        drug: DRUG,
        designType: "cross-sectional",
        rationale: "L1.5 多中心失衡信号扫描（T2DM 队列）",
        hospitals: [
          { participantId: HOSP_A, dataProductId: "dp-1" },
          { participantId: HOSP_B, dataProductId: "dp-2" },
        ],
        notBefore: "2026-09-24T00:00:00.000Z",
        notAfter: "2026-10-24T00:00:00.000Z",
      },
      currentSpaceId(),
    );
    const job = await jobs.submit({
      purpose: plan.purpose,
      applicant: plan.applicant,
      contracts: plan.contracts,
      stages: plan.stages,
      not_before: plan.not_before,
      not_after: plan.not_after,
    });

    const capabilities = new Map(
      [NODE_A, NODE_B, PLATFORM].map((node) => [
        node,
        {
          node,
          runtime: ["native", "wasm"],
          system_ops:
            node === PLATFORM
              ? ["merge.disproportionality@1.0.0"]
              : ["source.dataset@1.0.0", "declassify.small_cell@1.0.0"],
          whitelist_digests: [],
          tee: null,
          protocols: [],
        },
      ]),
    );
    const compiled = await jobs.compile({
      jobId: job.id,
      capabilities,
      jobNotBefore: plan.not_before,
      jobNotAfter: plan.not_after,
    });
    expect(compiled.fragments.map((f) => f.node).sort()).toEqual(
      [NODE_A, NODE_B, PLATFORM].sort(),
    );
    const jobAfterCompile = await jobsRepo.findOne({ where: { id: job.id } });
    expect(jobAfterCompile.status).toBe("COMPILED");

    // ── 2) 凭证要约 → 两院接受 → 平台签发 ───────────────────────────
    const outboxRepo = mockRepo();
    const ticketsRepo = mockRepo();
    const purge = new MdopPurgeService(
      jobsRepo,
      fragmentsRepo,
      outboxRepo,
      mockRepo(),
    );
    const ticketsSvc = new MdopTicketService(
      gm,
      ca,
      jobsRepo,
      fragmentsRepo,
      stagesRepo,
      ticketsRepo,
      mockRepo(),
      outboxRepo,
      certsRepo,
    );
    const { core, offeredNodes } = await ticketsSvc.offerTickets({
      jobId: job.id,
      notBefore: plan.not_before,
      notAfter: plan.not_after,
    });
    expect(offeredNodes.sort()).toEqual([NODE_A, NODE_B].sort());

    const snapshotA = canonicalSm3({
      dataset: "dp-1",
      stages: ["srcA", "l15A", "decA"],
    });
    const snapshotB = canonicalSm3({
      dataset: "dp-2",
      stages: ["srcB", "l15B", "decB"],
    });
    for (const [node, keys, snapshot] of [
      [NODE_A, keysA, snapshotA],
      [NODE_B, keysB, snapshotB],
    ] as const) {
      const acceptance = holderSignAcceptance(
        core,
        snapshot,
        node,
        keys.privateKey,
        keys.publicKey,
      );
      await ticketsSvc.accept(
        {
          jobId: job.id,
          ticketId: core.ticket_id,
          core,
          snapshot,
          signer: node,
          holderSignature: acceptance.sig,
        },
        { urn: node, publicKey: keys.publicKey },
      );
    }
    const jobTicked = await jobsRepo.findOne({ where: { id: job.id } });
    expect(jobTicked.status).toBe("TICKETED");
    const issued = await ticketsSvc.issuedTicket(job.id);
    expect(issued).not.toBeNull();

    // ── 3) 调度 → 各院产出 C3 并投递 ────────────────────────────────
    const scheduler = new MdopSchedulerService(
      jobsRepo,
      stagesRepo,
      outboxRepo,
      ticketsSvc,
      purge,
    );
    const dispatched = await scheduler.dispatchReadyStages(job.id);
    expect(dispatched).toBeGreaterThan(0);

    const tables = {
      [NODE_A]: {
        analysisType: "disproportionality" as const,
        cohortSize: 4,
        buckets: [{ key: "胰腺炎", count: 2, rate: 0.5, b: 1, c: 1, d: 0 }],
      },
      [NODE_B]: {
        analysisType: "disproportionality" as const,
        cohortSize: 4,
        buckets: [{ key: "胰腺炎", count: 1, rate: 0.25, b: 1, c: 1, d: 1 }],
      },
    };
    const deliveriesRepo = mockRepo();
    for (const node of [NODE_A, NODE_B]) {
      await deliveriesRepo.save(
        deliveriesRepo.create({
          id: `${node}:delivery`,
          jobId: job.id,
          node,
          handle: `art://${node}/${job.id}/dec/table`,
          label: "C3",
          digest: canonicalSm3(tables[node]),
          accepted: true,
          payload: tables[node],
        }),
      );
    }

    // ── 4) 平台收齐 → 合并 → SUCCEEDED ──────────────────────────────
    const merge = new MdopMergeService(
      jobsRepo,
      deliveriesRepo,
      fragmentsRepo,
      stagesRepo,
      purge,
    );
    const merged = await merge.mergeIfReady(job.id, {
      type: "disproportionality",
      level: "L1.5",
      drug: DRUG,
    } as never);
    expect(merged.merged).toBe(true);
    const jobSucceeded = await jobsRepo.findOne({ where: { id: job.id } });
    expect(jobSucceeded.status).toBe("SUCCEEDED");
    const expectedMerged = mergeDisproportionalityAggregates(
      { type: "disproportionality", level: "L1.5", drug: DRUG } as never,
      [tables[NODE_A], tables[NODE_B]] as never,
    );
    const platformResult = await merge.mergedResult(job.id);
    expect(platformResult).toEqual(
      expectedMerged as unknown as Record<string, unknown>,
    );

    // ── 5) 销毁编排 → 收齐回执 → PURGED ─────────────────────────────
    const { ordered } = await purge.orchestratePurge(job.id);
    expect(ordered.sort()).toEqual([NODE_A, NODE_B].sort());
    // 销毁回执由**发出方自己**签（平台侧现在验签 + 核对 node 与已认证发送方一致）
    const purgeKeys = new Map<
      string,
      { privateKey: string; publicKey: string }
    >();
    const purgeSender = (node: string) => {
      let key = purgeKeys.get(node);
      if (!key) {
        const pair = generateSm2KeyPair();
        key = {
          privateKey: pair.privateKey,
          publicKey: publicKeyFromPrivateKey(pair.privateKey),
        };
        purgeKeys.set(node, key);
      }
      return key;
    };
    for (const node of [NODE_A, NODE_B]) {
      const unsigned = {
        receipt_id: `rcpt-${node}`,
        job_id: job.id,
        node,
        reason: "purge-order",
        handles: [`art://${node}/${job.id}/dec/table`],
        destroyed_at: new Date().toISOString(),
        idempotency_key: `purge:${job.id}`,
      };
      const key = purgeSender(node);
      await purge.onPurgeReceipt(
        {
          ...unsigned,
          sig: signCanonicalObject(unsigned, key.privateKey, {
            publicKey: key.publicKey,
          }),
        } as never,
        { urn: node, publicKey: key.publicKey },
        PLATFORM,
      );
    }
    const jobPurged = await jobsRepo.findOne({ where: { id: job.id } });
    expect(jobPurged.status).toBe("PURGED");

    // ── 6) 审计回执链：平台校验 + 离线工具复算 ──────────────────────
    const receiptsRepo = mockRepo();
    const chain = new MdopReceiptChainService(receiptsRepo, jobsRepo);
    // 平台侧现在**验签 + 核对 signer**：夹具用该节点自己的私钥真签一份
    const nodeKeys = generateSm2KeyPair();
    const nodeSender = {
      urn: NODE_A,
      publicKey: publicKeyFromPrivateKey(nodeKeys.privateKey),
    };
    const receipt = (id: string, prev: string | null) => {
      const unsigned = {
        receipt_id: id,
        job_id: job.id,
        stage: "decA",
        event: "STAGE_SUCCEEDED",
        input_digests: [],
        op_digest: "component:x@1",
        output_digest: canonicalSm3({ n: 1 }),
        label: "C3",
        prev_receipt_hash: prev,
        signer: NODE_A,
        at: new Date().toISOString(),
      };
      return parseAuditReceipt({
        ...unsigned,
        sig: signCanonicalObject(unsigned, nodeKeys.privateKey, {
          publicKey: nodeSender.publicKey,
        }),
      });
    };
    const r1 = receipt("r1", null);
    const r2 = receipt("r2", canonicalSm3(r1));
    await chain.ingestAuditReceipt(r1, nodeSender);
    await chain.ingestAuditReceipt(r2, nodeSender);
    expect(await chain.verifyChain(NODE_A, job.id)).toMatchObject({
      valid: true,
      length: 2,
    });

    // ── 7) 离线核验：凭证（本地校验器）+ 回执链（离线脚本，不依赖平台）────
    const fragA = compiled.fragments.find((f) => f.node === NODE_A)!;
    expect(() =>
      verifyTicketForExecution({
        ticket: issued!,
        node: NODE_A,
        fragment: fragA as Fragment,
        nodePublicKey: keysA.publicKey,
        platformPublicKey: ca.platformNodePublicKey,
        platformParty: PLATFORM,
        now: new Date("2026-09-25T00:00:00.000Z"),
        recomputedSnapshot: snapshotA,
      }),
    ).not.toThrow();
    // 签发方与快照都锁进了凭证
    expect(issued!.signatures.map((s) => s.signer).sort()).toEqual(
      [NODE_A, NODE_B, PLATFORM].sort(),
    );
    expect(issued!.signatures.find((s) => s.signer === NODE_A)!.snapshot).toBe(
      snapshotA,
    );
    expect(publicKeyKid(keysA.publicKey)).toHaveLength(64);
    expect(parseTicketCore(issued!.core).plan_hash).toBe(
      jobAfterCompile.planHash,
    );

    const dir = mkdtempSync(join(tmpdir(), "mdop-e2e-"));
    const receiptsFile = join(dir, "receipts.json");
    writeFileSync(receiptsFile, JSON.stringify({ receipts: [r1, r2] }));
    const script = resolve(
      __dirname,
      "../../../connector/scripts/verify-receipt-chain.mjs",
    );
    const out = execFileSync(
      process.execPath,
      [script, "--receipts", receiptsFile],
      {
        encoding: "utf8",
        cwd: resolve(__dirname, "../../../connector"),
      },
    );
    expect(out).toMatch(/离线校验通过/);

    delete process.env.SPACE_ID;
  }, 120_000);
});
