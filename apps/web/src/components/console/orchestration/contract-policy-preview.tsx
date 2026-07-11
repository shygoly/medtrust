import { ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { PreviewRow } from "./orchestration-field";

export function ContractPolicyPreview({
  contract,
  hints,
  children,
}: {
  contract?: {
    purpose?: string;
    retention?: string;
    output?: string;
    dataProductId?: string;
    providerId?: string;
  } | null;
  hints?: string[];
  children?: React.ReactNode;
}) {
  return (
    <Panel ticks className="p-6 sticky top-6">
      <div className="cs-label mb-4">策略预览</div>
      {contract ? (
        <dl className="space-y-3 text-sm">
          <PreviewRow k="目的" v={String(contract.purpose ?? "—")} />
          <PreviewRow k="留存" v={String(contract.retention ?? "—")} />
          <PreviewRow k="输出" v={String(contract.output ?? "—")} />
          {contract.providerId && (
            <PreviewRow k="提供方" v={String(contract.providerId)} mono />
          )}
          {contract.dataProductId && (
            <PreviewRow k="产品" v={String(contract.dataProductId).slice(0, 20)} mono />
          )}
        </dl>
      ) : (
        <p className="text-xs" style={{ color: "var(--cs-faint)" }}>
          选择合约后显示策略
        </p>
      )}
      <div
        className="mt-5 pt-5 border-t space-y-2 text-[0.72rem]"
        style={{ borderColor: "var(--cs-line-soft)", color: "var(--cs-green)" }}
      >
        {(hints ?? [
          "连接器 prefetch 目录 → localDataPath",
          "仅授权产物出域，无原始行",
        ]).map((h) => (
          <div key={h} className="flex items-center gap-1.5">
            <ShieldCheck size={13} /> {h}
          </div>
        ))}
      </div>
      {children}
    </Panel>
  );
}
