import { ConflictException } from "@nestjs/common";
import { RwsOrchestratorController } from "./rws-orchestrator.controller";

const make = () => {
  const submitted: unknown[] = [];
  const orchestrator = {
    submit: async (input: unknown) => {
      submitted.push(input);
      return { taskId: "t1" };
    },
  } as never;
  return { ctrl: new RwsOrchestratorController(orchestrator), submitted };
};

describe("RwsOrchestratorController × 编排通道（D-MDOP-7）", () => {
  it("已登记的 legacy 类型照常提交（迁移期不拦）", async () => {
    const { ctrl, submitted } = make();
    const r = await ctrl.submit(
      {
        title: "t",
        purpose: "p",
        analysis: { type: "comparative-effect" },
        contractIds: ["c1"],
      } as never,
      "consumer-1",
    );
    expect(r).toEqual({ taskId: "t1" });
    expect(submitted).toHaveLength(1);
  });

  it("未登记的分析类型 fail-closed → 409，且不落到编排服务", async () => {
    const { ctrl, submitted } = make();
    // submit 是同步方法：抛错在调用处（Nest 会把同步 throw 同样映射成 409）。
    expect(() =>
      ctrl.submit(
        { analysis: { type: "not-a-registered-type" } } as never,
        "consumer-1",
      ),
    ).toThrow(ConflictException);
    expect(submitted).toHaveLength(0);
  });

  it("L1.5 已切换：旧入口提交 → 409，且不落到编排服务（D-MDOP-7）", () => {
    const { ctrl, submitted } = make();
    expect(() =>
      ctrl.submit({ analysis: { type: "disproportionality" } } as never, "consumer-1"),
    ).toThrow(ConflictException);
    expect(submitted).toHaveLength(0);
  });
});
