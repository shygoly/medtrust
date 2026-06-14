import { Lock } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
import { RoleGate } from "@/components/console/role-gate";
import { PublishProductButton } from "@/components/console/publish-product-button";
import { connectors } from "@/lib/space-mock";

const statusText: Record<string, string> = { online: "在线", idle: "空闲", offline: "离线" };

export default function ConnectorsPage() {
  return (
    <div>
      <PageHeader
        kicker="CONNECTORS · 连接器"
        title="参与方连接器"
        desc="每个连接器部署在参与方本地。原始数据驻留在其内网,凭中心 CA 签发的国密 SM2 证书接入空间。"
        action={
          <RoleGate roles={["provider"]}>
            <PublishProductButton />
          </RoleGate>
        }
      />
      <div className="p-8">
        <Panel ticks>
          <div
            className="grid grid-cols-12 px-6 py-3 cs-label border-b"
            style={{ borderColor: "var(--cs-line)" }}
          >
            <div className="col-span-3">参与方</div>
            <div className="col-span-2">角色 / 状态</div>
            <div className="col-span-3">SM2 证书</div>
            <div className="col-span-2">数据驻留</div>
            <div className="col-span-2 text-right">本地数据</div>
          </div>
          {connectors.map((c) => (
            <div key={c.id} className="cs-row grid grid-cols-12 px-6 py-4 items-center">
              <div className="col-span-3">
                <div className="text-sm font-medium">{c.org}</div>
                <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                  {c.id} · {c.region}
                </div>
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`cs-dot ${c.status === "online" ? "cs-dot-on" : c.status === "idle" ? "cs-dot-idle" : "cs-dot-off"}`}
                  />
                  {statusText[c.status]}
                </div>
                <div className="text-[0.7rem] mt-0.5" style={{ color: "var(--cs-dim)" }}>
                  {c.role === "provider" ? "数据提供方" : "数据使用方"}
                </div>
              </div>
              <div className="col-span-3">
                <div className="cs-mono text-[0.72rem]" style={{ color: "var(--cs-dim)" }}>
                  {c.certFingerprint}
                </div>
                <div className="text-[0.7rem] mt-0.5" style={{ color: "var(--cs-faint)" }}>
                  有效期至 {c.certValidUntil}
                </div>
              </div>
              <div className="col-span-2">
                <span
                  className="cs-chip"
                  style={{ color: "var(--cs-green)", borderColor: "var(--cs-green)" }}
                >
                  <Lock size={11} /> {c.residency.split(" · ")[1] ?? c.residency}
                </span>
              </div>
              <div className="col-span-2 text-right cs-mono tabular-nums text-sm" style={{ color: "var(--cs-text)" }}>
                {c.recordCount ? c.recordCount.toLocaleString() : "—"}
                <div className="text-[0.7rem]" style={{ color: "var(--cs-faint)" }}>
                  {c.datasetCount ? `${c.datasetCount} 个数据集` : "—"}
                </div>
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
