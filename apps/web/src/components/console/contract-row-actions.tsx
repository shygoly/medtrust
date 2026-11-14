"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

interface ContractRowActionsProps {
  contract: {
    id: string;
    canApprove?: boolean;
    canRevoke?: boolean;
    /** 申请方：待审批申请可撤回（撤回 ≠ 驳回，是申请人自己收回）。 */
    canWithdraw?: boolean;
    /** 待审批草稿上，当前使用方可确认规则知悉（P0-7）。 */
    canAcknowledge?: boolean;
    /** 使用方已确认规则知悉的时间；空则医院不能签发。 */
    consumerAcknowledgedAt?: string | null;
    /** 持有方签名和平台副署都在，才能用来发起任务。 */
    holderSigned?: boolean;
    /** unsigned / offered / agreed / active。offered 表示要约已发给连接器。 */
    mdopStatus?: string | null;
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

  if (
    !contract.canApprove &&
    !contract.canRevoke &&
    !contract.canWithdraw &&
    !contract.canAcknowledge
  ) {
    return null;
  }

  const withdraw = async () => {
    const reason = window.prompt("撤回原因（可留空）：", "");
    if (reason === null) return;
    if (!window.confirm("确认撤回这份申请？撤回后医院无需再处理，这份合约不会生效。")) return;
    setBusy(true);
    setMsg("撤回中…");
    try {
      await api.withdrawContractDraft(contract.id, reason.trim() || undefined);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg("已撤回");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async () => {
    if (
      !window.confirm(
        "确认已知悉本合约的用途、留存期限、输出策略与合规预审裁决？确认后医院方可签发。",
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("确认中…");
    try {
      await api.acknowledgeContract(contract.id);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg("已确认规则知悉");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

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
      if (action === "approve") {
        const approved = await api.approveContractDraft(contract.id, ack);
        const offer = approved?.mdopOffer as
          | { offered?: boolean; reason?: string }
          | undefined;
        setMsg(
          offer?.offered
            ? "已签发，签署要约已发给医院连接器"
            : `已签发，签署要约未发出：${offer?.reason || "请稍后点重新发送"}`,
        );
      } else {
        await api.rejectContractDraft(contract.id);
        setMsg("已驳回");
      }
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
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

  const resendOffer = async () => {
    setBusy(true);
    setMsg("发送签署要约…");
    try {
      await api.offerMdopContract(contract.id, {});
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg("签署要约已发给医院连接器");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  const btnClass = variant === "panel" ? "cs-btn" : "cs-btn text-xs";
  const waitingConnector =
    contract.mdopStatus === "offered" || contract.mdopStatus === "agreed";

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      {contract.canWithdraw && (
        <button
          className={btnClass}
          disabled={busy}
          style={{ opacity: 0.8 }}
          onClick={() => void withdraw()}
        >
          撤回申请
        </button>
      )}
      {contract.canAcknowledge && (
        <button className={btnClass} disabled={busy} onClick={() => void acknowledge()}>
          确认规则知悉
        </button>
      )}
      {contract.canApprove && (
        <>
          <button
            className={btnClass}
            disabled={busy || !contract.consumerAcknowledgedAt}
            title={
              contract.consumerAcknowledgedAt
                ? "签发此合约"
                : "使用方尚未确认规则知悉，暂不能签发"
            }
            onClick={() => approveOrReject("approve")}
          >
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
          {!contract.consumerAcknowledgedAt && (
            <span className="cs-label text-xs whitespace-nowrap">待使用方确认规则知悉</span>
          )}
        </>
      )}
      {contract.canRevoke && !contract.holderSigned && !waitingConnector && (
        <button className={btnClass} disabled={busy} onClick={() => void resendOffer()}>
          重新发送签署要约
        </button>
      )}
      {contract.canRevoke && !contract.holderSigned && waitingConnector && (
        <span className="cs-label text-xs whitespace-nowrap">等待连接器确认</span>
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
