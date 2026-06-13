import Link from "next/link";
import { PageHeader, Panel } from "@/components/console/ui";
import { attestations } from "@/lib/space-mock";

const kindLabel: Record<string, string> = { policy: "策略存证", task: "任务存证", output: "结果存证" };
const kindColor: Record<string, string> = {
  policy: "var(--cs-cyan)",
  task: "var(--cs-amber)",
  output: "var(--cs-green)",
};

export default function AttestationsPage() {
  return (
    <div>
      <PageHeader
        kicker="ATTESTATIONS · 存证账本"
        title="上链存证"
        desc="任务定义、授权策略、输出结果的哈希与指纹上链(FISCO BCOS)。链上不含任何医疗数据明文,仅作不可抵赖的审计凭据。"
      />
      <div className="p-8">
        <Panel ticks>
          <div className="grid grid-cols-12 px-6 py-3 cs-label border-b" style={{ borderColor: "var(--cs-line)" }}>
            <div className="col-span-2">类型</div>
            <div className="col-span-4">关联任务</div>
            <div className="col-span-3">指纹 / 哈希</div>
            <div className="col-span-2">参与方</div>
            <div className="col-span-1 text-right">区块</div>
          </div>
          {attestations.map((a) => (
            <div key={a.id} className="cs-row grid grid-cols-12 px-6 py-4 items-center">
              <div className="col-span-2">
                <span className="cs-chip" style={{ color: kindColor[a.kind], borderColor: kindColor[a.kind] }}>
                  {kindLabel[a.kind]}
                </span>
              </div>
              <div className="col-span-4 min-w-0">
                <Link href={`/space/tasks/${a.taskId}`} className="text-sm hover:underline truncate block">
                  {a.taskTitle}
                </Link>
                <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-cyan)" }}>{a.txHash}</div>
              </div>
              <div className="col-span-3 cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                <div>in · {a.inputFingerprint}</div>
                <div>out · {a.outputHash}</div>
              </div>
              <div className="col-span-2 text-[0.72rem]" style={{ color: "var(--cs-dim)" }}>
                {a.participants.join(" · ")}
              </div>
              <div className="col-span-1 text-right cs-mono text-xs tabular-nums" style={{ color: "var(--cs-dim)" }}>
                #{a.block.toLocaleString()}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
