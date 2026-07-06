"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { type AttestationRow, toAttestationRows } from "@/lib/attestations";

const typeColor: Record<string, string> = {
  CUSTOM: "var(--cs-cyan)",
  PRESCRIPTION: "var(--cs-amber)",
  MEDICAL_RECORD: "var(--cs-green)",
  DRUG_TRACEABILITY: "var(--cs-cyan)",
};

export function AttestationsLedger() {
  const [rows, setRows] = useState<AttestationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const items = await api.getBlockchainAttestations();
        if (!cancelled) setRows(toAttestationRows(items));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load attestations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="grid grid-cols-12 px-6 py-3 cs-label border-b" style={{ borderColor: "var(--cs-line)" }}>
        <div className="col-span-2">类型</div>
        <div className="col-span-3">数据 / 状态</div>
        <div className="col-span-3">链上交易</div>
        <div className="col-span-3">元数据</div>
        <div className="col-span-1 text-right">区块</div>
      </div>

      {loading && <StateRow text="正在读取真实链上存证..." />}
      {error && <StateRow text={`无法读取存证账本: ${error}`} tone="error" />}
      {!loading && !error && rows.length === 0 && <StateRow text="暂无真实存证记录。" />}
      {!loading && !error && rows.map((row) => <LedgerRow key={row.id} row={row} />)}
    </>
  );
}

function LedgerRow({ row }: { row: AttestationRow }) {
  const color = typeColor[row.type] ?? "var(--cs-cyan)";
  return (
    <div className="cs-row grid grid-cols-12 px-6 py-4 items-center">
      <div className="col-span-2">
        <span className="cs-chip" style={{ color, borderColor: color }}>{row.type}</span>
      </div>
      <div className="col-span-3 min-w-0">
        <div className="text-sm truncate">{row.dataId}</div>
        <div className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>{row.status}</div>
      </div>
      <div className="col-span-3 cs-mono text-[0.68rem] min-w-0" style={{ color: "var(--cs-faint)" }}>
        <div className="truncate">tx · {row.txHash}</div>
        <div className="truncate">hash · {row.dataHash}</div>
      </div>
      <div className="col-span-3 text-[0.72rem] truncate" style={{ color: "var(--cs-dim)" }}>
        {row.metadataSummary}
      </div>
      <div className="col-span-1 text-right cs-mono text-xs tabular-nums" style={{ color: "var(--cs-dim)" }}>
        {row.blockNumber == null ? "pending" : `#${row.blockNumber.toLocaleString()}`}
      </div>
    </div>
  );
}

function StateRow({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div className="px-6 py-8 text-sm" style={{ color: tone === "error" ? "var(--cs-red)" : "var(--cs-dim)" }}>
      {text}
    </div>
  );
}
