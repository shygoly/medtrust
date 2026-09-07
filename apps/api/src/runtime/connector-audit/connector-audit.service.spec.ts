import { ConnectorAuditService } from "./connector-audit.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("ConnectorAuditService — 审计摘要接收/查验(P0-6)", () => {
  let svc: ConnectorAuditService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    repo = mockRepo();
    svc = new ConnectorAuditService(repo as any);
  });

  it("records a first digest with chainOk=ok", async () => {
    const d = await svc.record("huashan", {
      count: 3,
      firstPrevHash: "GENESIS",
      lastEntryHash: "SM3:aaa",
    });
    expect(d.chainOk).toBe("ok");
    expect(d.count).toBe(3);
  });

  it("marks chain break when the chain head does not chain to the previous tail", async () => {
    await svc.record("huashan", {
      count: 3,
      firstPrevHash: "GENESIS",
      lastEntryHash: "SM3:aaa",
    });
    const d = await svc.record("huashan", {
      count: 6,
      firstPrevHash: "SM3:zzz",
      lastEntryHash: "SM3:bbb",
    });
    expect(d.chainOk).toBe("break");
  });

  it("marks ok when the chain head chains to the previous tail", async () => {
    await svc.record("huashan", {
      count: 3,
      firstPrevHash: "GENESIS",
      lastEntryHash: "SM3:aaa",
    });
    const d = await svc.record("huashan", {
      count: 6,
      firstPrevHash: "SM3:aaa",
      lastEntryHash: "SM3:bbb",
    });
    expect(d.chainOk).toBe("ok");
  });

  it("lists digests for a participant", async () => {
    await svc.record("huashan", {
      count: 1,
      firstPrevHash: "GENESIS",
      lastEntryHash: "SM3:x",
    });
    const list = await svc.list("huashan");
    expect(list).toHaveLength(1);
    expect(list[0].participantId).toBe("huashan");
  });
});
