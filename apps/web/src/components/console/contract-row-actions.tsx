"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

interface ContractRowActionsProps {
  contract: {
    id: string;
    canApprove?: boolean;
  };
  /** Larger buttons for the pending-approval panel */
  variant?: "inline" | "panel";
}

export function ContractRowActions({ contract, variant = "inline" }: ContractRowActionsProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!contract.canApprove) return null;

  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    setMsg(action === "approve" ? "签发中…" : "驳回中…");
    try {
      if (action === "approve") await api.approveContractDraft(contract.id);
      else await api.rejectContractDraft(contract.id);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg(action === "approve" ? "已签发 ✓" : "已驳回");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  const btnClass = variant === "panel" ? "cs-btn" : "cs-btn text-xs";

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      <button className={btnClass} disabled={busy} onClick={() => act("approve")}>
        签发
      </button>
      <button
        className={btnClass}
        disabled={busy}
        style={{ opacity: 0.75 }}
        onClick={() => act("reject")}
      >
        驳回
      </button>
      {msg && <span className="cs-label text-xs whitespace-nowrap">{msg}</span>}
    </div>
  );
}
