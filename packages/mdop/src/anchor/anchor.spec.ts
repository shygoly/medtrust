import { canonicalSm3 } from "../crypto/sm3";
import { parseAnchorRecord } from "../schema/artifact";
import { SchemaError } from "../schema/strict";
import { anchorChainHead, type ChainAnchorSink } from "./anchor";

const NOW = new Date("2026-09-26T02:00:00.000Z");
const now = () => NOW;
const NODE = "urn:tds:sh-med:participant:tee-1";
/** 真实的链头就是从上一跳摘要算出来的，这里用同一条算法造一个合法形状。 */
const HEAD = canonicalSm3({ event: "EXITED", prev: null, detail: { label: "C3" } });

interface AnchorCall {
  job_id: string;
  node: string;
  chain_head: string;
}

/** 存证链写入端替身：可控「通 / 抛错 / 返回空白交易号」。 */
class SinkDouble implements ChainAnchorSink {
  readonly calls: AnchorCall[] = [];
  constructor(
    private readonly mode: "ok" | "throw" | "blank" = "ok",
    private readonly txId = "0xabc123",
  ) {}
  async anchor(input: AnchorCall): Promise<{ tx_id: string }> {
    this.calls.push(input);
    if (this.mode === "throw") throw new Error("存证链不可达");
    return { tx_id: this.mode === "blank" ? "   " : this.txId };
  }
}

describe("锚定接缝：链头 → anchorRecord（协议 §10：失败进补偿队列，不得伪造交易号）", () => {
  it("写入端可用 → anchored：带交易号与时间戳，记录可被 parseAnchorRecord 读回", async () => {
    const sink = new SinkDouble("ok", "0xdeadbeef");
    const record = await anchorChainHead({
      job_id: "job-1",
      node: NODE,
      chain_head: HEAD,
      sink,
      now,
    });

    expect(record).toEqual({
      node: NODE,
      chain_head: HEAD,
      status: "anchored",
      tx_id: "0xdeadbeef",
      anchored_at: NOW.toISOString(),
    });
    // 写入端拿到的入参是原样链头（不重算、不改写）
    expect(sink.calls).toEqual([{ job_id: "job-1", node: NODE, chain_head: HEAD }]);
    // 落库/传输一趟后仍可读回（JCS 可序列化 + schema 可解析）
    expect(parseAnchorRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it("未接存证链（未注入写入端）→ pending，且记录里**没有** tx_id 键", async () => {
    const record = await anchorChainHead({ job_id: "job-1", node: NODE, chain_head: HEAD });
    expect(record).toEqual({ node: NODE, chain_head: HEAD, status: "pending" });
    expect("tx_id" in record).toBe(false);
    expect(JSON.stringify(record)).not.toContain("tx_id");
    // pending 记录同样是合法锚定记录（第三方离线核验读到它就知道「还没上链」）
    expect(parseAnchorRecord(record).status).toBe("pending");
  });

  it("存证链不可达（写入端抛错）→ pending，不把异常冒给作业、不伪造交易号", async () => {
    const sink = new SinkDouble("throw");
    const record = await anchorChainHead({
      job_id: "job-1",
      node: NODE,
      chain_head: HEAD,
      sink,
      now,
    });
    expect(record.status).toBe("pending");
    expect("tx_id" in record).toBe(false);
    expect(record.anchored_at).toBeUndefined();
    expect(sink.calls).toHaveLength(1); // 真去试过写，不是「干脆不写」
  });

  it("写入端返回空白交易号 → pending（空串/空白不得当交易号）", async () => {
    const record = await anchorChainHead({
      job_id: "job-1",
      node: NODE,
      chain_head: HEAD,
      sink: new SinkDouble("blank"),
      now,
    });
    expect(record.status).toBe("pending");
    expect("tx_id" in record).toBe(false);
  });

  it("链头形状非法 → 抛错并指名字段，且**一次也不去写链**（调用方 bug 不得降级成 pending）", async () => {
    const sink = new SinkDouble();
    // 形状不对（不是 sm3:<64hex>）：报错指名字段路径
    await expect(
      anchorChainHead({ job_id: "job-1", node: NODE, chain_head: "0xnotahash", sink, now }),
    ).rejects.toThrow(/anchorRecord\.chain_head/);
    // 空串：连「一个非空字符串」都不算，错误信息同样必须落在 chain_head 上
    await expect(
      anchorChainHead({ job_id: "job-1", node: NODE, chain_head: "", sink, now }),
    ).rejects.toThrow(SchemaError);
    await expect(
      anchorChainHead({ job_id: "job-1", node: NODE, chain_head: "", sink, now }),
    ).rejects.toThrow(/chain_head/);
    expect(sink.calls).toHaveLength(0);
  });

  it("锚定记录只可能是 pending/anchored 两态（没有第三种「装作已锚」的写法）", async () => {
    const anchored = await anchorChainHead({
      job_id: "job-1",
      node: NODE,
      chain_head: HEAD,
      sink: new SinkDouble(),
      now,
    });
    const pending = await anchorChainHead({ job_id: "job-1", node: NODE, chain_head: HEAD });
    for (const record of [anchored, pending]) {
      expect(["pending", "anchored"]).toContain(record.status);
      // 已锚必须有交易号；未锚必须没有 —— 两态互斥，杜绝「有 tx_id 但状态是 pending」这类缝合
      if (record.status === "anchored") expect(typeof record.tx_id).toBe("string");
      else expect(record.tx_id).toBeUndefined();
    }
  });
});
