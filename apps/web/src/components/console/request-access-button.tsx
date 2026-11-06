"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldPlus } from "lucide-react";
import { api } from "@/api/client";

/**
 * 使用方在目录里发起「访问授权申请」。
 *
 * 只发起，不授予：真正的能力仍由提供方批准后生成（D-ACL-1）。
 * 已授权 / 已申请时不显示按钮，避免重复申请。
 */
export function RequestAccessButton({
  dataProductId,
  state,
}: {
  dataProductId: string;
  state: "granted" | "pending" | "none";
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (state === "granted") {
    return (
      <span className="cs-chip text-xs" style={{ borderColor: "var(--cs-green)", color: "var(--cs-green)" }}>
        已授权
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="cs-chip text-xs" style={{ borderColor: "var(--cs-amber)", color: "var(--cs-amber)" }}>
        已申请 · 待提供方处理
      </span>
    );
  }

  const submit = async () => {
    if (!window.confirm("向数据提供方申请访问这份数据产品？批准后即可发起作业。")) return;
    setBusy(true);
    setMsg("提交中…");
    try {
      await api.requestDataAccess({ dataProductId, permissions: ["compute"] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-state"] }),
        queryClient.invalidateQueries({ queryKey: ["access-requests"] }),
      ]);
      setMsg("已提交申请");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="cs-btn cs-btn-ghost text-xs"
        disabled={busy}
        onClick={() => void submit()}
        title="向数据提供方申请产品级访问授权（批准后才能发起作业）"
      >
        <ShieldPlus size={13} /> 申请访问
      </button>
      {msg && (
        <span className="cs-mono text-[0.65rem] max-w-[180px] text-right truncate" style={{ color: "var(--cs-cyan)" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
