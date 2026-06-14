"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";

// Provider-only action: publishes a data product via the real, role-guarded
// POST /catalog (server enforces provider role + confirm/classify gate).
export function PublishProductButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("敏感");
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("提交中…");
    try {
      const user = getUser();
      const r: any = await api.createDataAsset({
        providerId: user?.participantId,
        title,
        classification,
        rightsConfirmed: true,
        recordCount: 0,
      } as any);
      setMsg(`已发布 ✓ ${String(r.id).slice(0, 8)}`);
      setTitle("");
    } catch (e: any) {
      setMsg("失败: " + (e?.message || "请求错误"));
    }
  };

  if (!open) {
    return (
      <button className="cs-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> 发布数据产品
      </button>
    );
  }
  return (
    <div className="cs-panel p-3 flex items-center gap-2">
      <input
        className="cs-input"
        style={{ width: 200 }}
        placeholder="数据产品标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select className="cs-input" style={{ width: 110 }} value={classification} onChange={(e) => setClassification(e.target.value)}>
        <option>敏感</option>
        <option>重要</option>
        <option>一般</option>
      </select>
      <button className="cs-btn" disabled={!title} onClick={submit}>
        确权并发布
      </button>
      {msg && <span className="cs-label" style={{ whiteSpace: "nowrap" }}>{msg}</span>}
    </div>
  );
}
