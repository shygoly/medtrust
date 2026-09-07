import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { PreviewRow } from "./orchestration-field";

export function ContractPolicyPreview({
  contract,
  hints,
  requiredArtifacts,
  requiredLevels,
  children,
}: {
  contract?: {
    purpose?: string;
    retention?: string;
    output?: string;
    dataProductId?: string;
    providerId?: string;
    outputPolicy?: {
      preset?: string;
      allowedArtifacts?: string[];
      minCell?: number;
      dp?: { mode?: string };
    } | null;
    /** rws-algorithm-validation: contract authorizations the connector PEP
     * checks on every task. When `requiredArtifacts`/`requiredLevels` is
     * provided, missing entries surface as a mismatch warning below. */
    allowedArtifacts?: string[];
    allowedLevels?: string[];
  } | null;
  hints?: string[];
  /** When set, the preview checks the contract authorizes these artifacts
   * (e.g. `["validation_metrics"]` for L0) and flags any missing. */
  requiredArtifacts?: string[];
  /** When set, the preview checks the contract authorizes these analysis
   * levels (e.g. `["L0"]`). */
  requiredLevels?: string[];
  children?: React.ReactNode;
}) {
  // Compute the authorization mismatch (used by L0 to gate submit). Empty
  // when no requirements were requested OR the contract satisfies them all.
  //
  // IMPORTANT: only flag a mismatch when the contract actually DECLARES an
  // authorization list. Catalog contracts today don't carry allowedArtifacts
  // / allowedLevels (those fields live on the per-assignment snapshot); a
  // missing field therefore means "catalog doesn't expose this yet", not
  // "contract denies this". We only flag what we can prove is missing.
  const declaresArtifacts =
    Array.isArray(contract?.allowedArtifacts) &&
    (contract?.allowedArtifacts?.length ?? 0) > 0;
  const declaresLevels =
    Array.isArray(contract?.allowedLevels) &&
    (contract?.allowedLevels?.length ?? 0) > 0;
  const missingArtifacts = declaresArtifacts
    ? (requiredArtifacts?.filter(
        (a) => !contract?.allowedArtifacts?.includes(a),
      ) ?? [])
    : [];
  const missingLevels = declaresLevels
    ? (requiredLevels?.filter(
        (l) => !contract?.allowedLevels?.includes(l),
      ) ?? [])
    : [];
  const mismatch = missingArtifacts.length + missingLevels.length > 0;

  return (
    <Panel ticks className="p-6 sticky top-6">
      <div className="cs-label mb-4">策略预览</div>
      {contract ? (
        <dl className="space-y-3 text-sm">
          <PreviewRow k="目的" v={String(contract.purpose ?? "—")} />
          <PreviewRow k="留存" v={String(contract.retention ?? "—")} />
          <PreviewRow k="输出" v={String(contract.output ?? "—")} />
          {contract.outputPolicy?.minCell != null && (
            <PreviewRow k="闸门 minCell" v={String(contract.outputPolicy.minCell)} mono />
          )}
          {contract.outputPolicy?.allowedArtifacts &&
            contract.outputPolicy.allowedArtifacts.length > 0 && (
              <PreviewRow
                k="闸门制品类"
                v={contract.outputPolicy.allowedArtifacts.join(" · ")}
                mono
              />
            )}
          {contract.outputPolicy?.dp?.mode && (
            <PreviewRow k="差分隐私" v={String(contract.outputPolicy.dp.mode)} mono />
          )}
          {contract.providerId && (
            <PreviewRow k="提供方" v={String(contract.providerId)} mono />
          )}
          {contract.dataProductId && (
            <PreviewRow k="产品" v={String(contract.dataProductId).slice(0, 20)} mono />
          )}
          {contract.allowedArtifacts && contract.allowedArtifacts.length > 0 && (
            <PreviewRow
              k="授权产物"
              v={contract.allowedArtifacts.join(" · ")}
              mono
            />
          )}
          {contract.allowedLevels && contract.allowedLevels.length > 0 && (
            <PreviewRow
              k="授权分级"
              v={contract.allowedLevels.join(" · ")}
              mono
            />
          )}
        </dl>
      ) : (
        <p className="text-xs" style={{ color: "var(--cs-faint)" }}>
          选择合约后显示策略
        </p>
      )}

      {mismatch && (
        <div
          className="mt-4 flex items-start gap-2 text-[0.72rem]"
          style={{ color: "var(--cs-amber)" }}
        >
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <div>
            合约未授权本任务所需项，提交将被连接器 PEP 拒绝：
            {missingArtifacts.length > 0 && (
              <div className="mt-1">
                缺产物：
                <span className="cs-mono">
                  {missingArtifacts.join(", ")}
                </span>
              </div>
            )}
            {missingLevels.length > 0 && (
              <div>
                缺分级：
                <span className="cs-mono">{missingLevels.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className="mt-5 pt-5 border-t space-y-2 text-[0.72rem]"
        style={{
          borderColor: "var(--cs-line-soft)",
          color: mismatch ? "var(--cs-amber)" : "var(--cs-green)",
        }}
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
