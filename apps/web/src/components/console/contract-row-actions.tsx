"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

interface ContractRowActionsProps {
  contract: {
    id: string;
    canApprove?: boolean;
    canRevoke?: boolean;
    /** 预审裁决快照（D-CMP-2）：verdict=manual_review 时签发须填确认理由。 */
    preReview?: { verdict?: string; overallRisk?: string } | null;
  };
  /** Larger buttons for the pending-approval panel */
  variant?: "inline" | "panel";
}

export function ContractRowActions({ contract, variant = "inline" }: ContractRowActionsProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!contract.canApprove && !contract.canRevoke) return null;

  const approveOrReject = async (action: "approve" | "reject") => {
    // D-CMP-2：预审裁决为「需审批」时，医院签发须显式确认并填写理由（计入合约哈希）。
    let ack: { reason: string } | undefined;
    if (action === "approve" && contract.preReview?.verdict === "manual_review") {
      const reason = window.prompt(
        `预审裁决为「需审批」(总体风险 ${contract.preReview?.overallRisk ?? "?"})。签发须填写确认理由(留痕并计入合约哈希):`,
        "",
      );
      if (reason === null) return;
      if (!reason.trim()) {
        setMsg("失败: 需审批合约的确认理由不可为空");
        return;
      }
      ack = { reason: reason.trim() };
    }
    setBusy(true);
    setMsg(action === "approve" ? "签发中…" : "驳回中…");
    try {
      if (action === "approve") await api.approveContractDraft(contract.id, ack);
      else await api.rejectContractDraft(contract.id);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg(action === "approve" ? "已签发 ✓" : "已驳回");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  // P1-3:Provider 解除 active 合约(二次确认+原因);PEP 已强制,解除后下游任务立刻 pep-deny。
  const revoke = async () => {
    const reason = window.prompt("解除原因(留痕,必填):", "");
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg("失败: 解除原因不可为空");
      return;
    }
    if (!window.confirm(`确认解除合约 ${contract.id.slice(0, 8)}?解除后下游任务将被 PEP 拒绝。`)) return;
    setBusy(true);
    setMsg("解除中…");
    try {
      await api.revokeContract(contract.id, reason.trim());
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg("已解除");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  const btnClass = variant === "panel" ? "cs-btn" : "cs-btn text-xs";

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      {contract.canApprove && (
        <>
          <button className={btnClass} disabled={busy} onClick={() => approveOrReject("approve")}>
            签发
          </button>
          <button
            className={btnClass}
            disabled={busy}
            style={{ opacity: 0.75 }}
            onClick={() => approveOrReject("reject")}
          >
            驳回
          </button>
        </>
      )}
      {contract.canRevoke && (
        <button
          className={btnClass}
          disabled={busy}
          style={{ borderColor: "var(--cs-red)", color: "var(--cs-red)" }}
          onClick={revoke}
        >
          解除
        </button>
      )}
      {msg && <span className="cs-label text-xs whitespace-nowrap">{msg}</span>}
    </div>
  );
}
