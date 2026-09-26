import { generateSm2KeyPair } from "../crypto/sm2";
import { MdopError } from "../errors";
import { computePlanHash, fragmentHash } from "../plan/hash";
import { parseFragment, type Fragment } from "../schema/plan";
import { parseTicketCore, type TicketCore } from "../schema/ticket";
import {
  buildTicket,
  holderSignAcceptance,
  platformSignCore,
  verifyHolderAcceptance,
  verifyTicketForExecution,
} from "./verify";

const hospA = generateSm2KeyPair();
const hospB = generateSm2KeyPair();
const platform = generateSm2KeyPair();
const NODE = "urn:tds:space-x:participant:hospA";
const PLATFORM_PARTY = "urn:tds:space-x:participant:platform";

const fragment: Fragment = parseFragment({
  node: NODE,
  stages: [
    {
      id: "s1",
      node: NODE,
      op: "rws.disproportionality@1.0.0",
      op_digest: "component:connector@1",
      params: { minCell: 10 },
      inputs: [],
      input_labels: ["C0"],
      output_label: "C3",
      output_schema: "mdop.table/1.0",
    },
  ],
  edges: [],
});

const job = {
  job_id: "job-1",
  purpose: "RWS.EFFECTIVENESS",
  applicant: { org: "sponsor", project: "t2dm" },
  contracts: ["ctr-A"],
  not_before: "2026-09-24T00:00:00Z",
  not_after: "2026-10-01T00:00:00Z",
};

const SNAPSHOT = `sm3:${"5".repeat(64)}`;

function core(): TicketCore {
  return parseTicketCore({
    ticket_id: "tkt-1",
    job_id: "job-1",
    plan_hash: computePlanHash({
      job,
      fragments: { [NODE]: fragmentHash(fragment), "urn:tds:space-x:participant:hospB": `sm3:${"b".repeat(64)}` },
    }),
    fragments: {
      [NODE]: fragmentHash(fragment),
      "urn:tds:space-x:participant:hospB": `sm3:${"b".repeat(64)}`,
    },
    not_before: "2026-09-24T00:00:00Z",
    not_after: "2026-10-01T00:00:00Z",
  });
}

function ticket() {
  const c = core();
  return buildTicket(
    c,
    [holderSignAcceptance(c, SNAPSHOT, NODE, hospA.privateKey, hospA.publicKey)],
    platformSignCore(c, platform.privateKey, platform.publicKey, PLATFORM_PARTY),
  );
}

const verify = (over: Partial<Parameters<typeof verifyTicketForExecution>[0]> = {}) =>
  verifyTicketForExecution({
    ticket: ticket(),
    node: NODE,
    fragment,
    nodePublicKey: hospA.publicKey,
    platformPublicKey: platform.publicKey,
    platformParty: PLATFORM_PARTY,
    now: new Date("2026-09-25T00:00:00Z"),
    ...over,
  });

describe("执行凭证校验（规格「执行前凭证校验」）", () => {
  it("全绿时通过", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify({ recomputedSnapshot: SNAPSHOT })).not.toThrow();
  });

  it("凭证缺少本院签名 → E_TICKET_INVALID", () => {
    expect(() =>
      verify({
        ticket: (() => {
          const c = core();
          return buildTicket(
            c,
            [holderSignAcceptance(c, SNAPSHOT, "urn:tds:space-x:participant:hospB", hospB.privateKey, hospB.publicKey)],
            platformSignCore(c, platform.privateKey, platform.publicKey, PLATFORM_PARTY),
          );
        })(),
      }),
    ).toThrow(expect.objectContaining({ code: "E_TICKET_INVALID" }));
  });

  it("平台在签发后改动本节点片段 → E_TICKET_INVALID", () => {
    const tampered = parseFragment({
      ...fragment,
      stages: [{ ...fragment.stages[0], params: { minCell: 1 } }],
    });
    expect(() => verify({ fragment: tampered })).toThrow(
      expect.objectContaining({ code: "E_TICKET_INVALID" }),
    );
  });

  it("凭证过期 → E_TICKET_INVALID", () => {
    expect(() => verify({ now: new Date("2026-10-02T00:00:00Z") })).toThrow(
      expect.objectContaining({ code: "E_TICKET_INVALID" }),
    );
  });

  it("平台用别的密钥签凭证 → E_TICKET_INVALID", () => {
    const other = generateSm2KeyPair();
    const c = core();
    expect(() =>
      verify({
        ticket: buildTicket(
          c,
          [holderSignAcceptance(c, SNAPSHOT, NODE, hospA.privateKey, hospA.publicKey)],
          platformSignCore(c, other.privateKey, other.publicKey, PLATFORM_PARTY),
        ),
      }),
    ).toThrow(expect.objectContaining({ code: "E_TICKET_INVALID" }));
  });

  it("平台签名的主体不是本地固定的平台节点 → E_TICKET_INVALID", () => {
    expect(() => verify({ platformParty: "urn:tds:space-x:participant:evil" })).toThrow(
      MdopError,
    );
  });

  it("数据在接受后变化 → E_SNAPSHOT_CHANGED", () => {
    expect(() => verify({ recomputedSnapshot: `sm3:${"9".repeat(64)}` })).toThrow(
      expect.objectContaining({ code: "E_SNAPSHOT_CHANGED" }),
    );
  });

  it("本院快照在接受签名里被绑住：改快照即验不过", () => {
    const c = core();
    const sig = holderSignAcceptance(c, SNAPSHOT, NODE, hospA.privateKey, hospA.publicKey);
    expect(verifyHolderAcceptance(c, sig, hospA.publicKey)).toBe(true);
    const forged = { ...sig, snapshot: `sm3:${"7".repeat(64)}` };
    expect(verifyHolderAcceptance(c, forged, hospA.publicKey)).toBe(false);
  });

  it("平台伪造本院接受签名（用平台自己的私钥签 holder 角色）→ 执行器拒绝", () => {
    const c = core();
    const forged = holderSignAcceptance(c, SNAPSHOT, NODE, platform.privateKey, platform.publicKey);
    expect(() =>
      verify({
        ticket: buildTicket(c, [forged], platformSignCore(c, platform.privateKey, platform.publicKey, PLATFORM_PARTY)),
      }),
    ).toThrow(expect.objectContaining({ code: "E_TICKET_INVALID" }));
  });
});

describe("作业与阶段状态机", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    assertJobTransition,
    assertStageTransition,
    canTransitionJob,
    retryBackoffSeconds,
    idempotencyKey,
  } = require("../state/job-state") as typeof import("../state/job-state");

  it("合法迁移表：主线通过，REJECTED / PURGED 是终态", () => {
    expect(() => assertJobTransition("SUBMITTED", "COMPILED")).not.toThrow();
    expect(() => assertJobTransition("NEGOTIATING", "REJECTED")).not.toThrow();
    expect(canTransitionJob("REJECTED", "RUNNING")).toBe(false);
    expect(canTransitionJob("PURGED", "RUNNING")).toBe(false);
    expect(canTransitionJob("SUCCEEDED", "PURGED")).toBe(true);
  });

  it("非法迁移被拒绝并报错（由调用方记审计）", () => {
    expect(() => assertJobTransition("REJECTED", "RUNNING")).toThrow(
      expect.objectContaining({ code: "E_RUNTIME" }),
    );
    expect(() => assertStageTransition("SUCCEEDED", "RUNNING")).toThrow(MdopError);
  });

  it("重试退避为 30/60/120 秒，幂等键是 job:stage:attempt", () => {
    expect([1, 2, 3].map(retryBackoffSeconds)).toEqual([30, 60, 120]);
    expect(idempotencyKey("job-1", "s1", 2)).toBe("job-1:s1:2");
  });
});
