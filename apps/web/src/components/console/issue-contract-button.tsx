"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";

const PURPOSES = ["CKD 多中心疗效真实世界研究", "肾内科病历文本 RWE", "院内授权联调"];
const RETENTIONS = ["阅后即焚", "结果留存 90 天"];
const OUTPUTS = ["仅聚合统计", "仅模型增量"];

/** Provider-only: directly issue an active contract (skip consumer request). */
export function IssueContractButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataProductId, setDataProductId] = useState("dp-neph-text");
  const [consumerId, setConsumerId] = useState("p-meddata");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [retention, setRetention] = useState(RETENTIONS[0]);
  const [output, setOutput] = useState(OUTPUTS[0]);
  const [validDays, setValidDays] = useState(90);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("签发中…");
    try {
      const user = getUser();
      if (!user?.participantId) throw new Error("未识别参与方身份");
      const r = await api.issueContract({
        dataProductId,
        providerId: user.participantId,
        consumerId,
        purpose,
        retention,
        output,
        validDays,
      });
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg(`已签发 ✓ ${String(r.id).slice(0, 8)}`);
      setOpen(false);
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    }
  };

  if (!open) {
    return (
      <button className="cs-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> 直接签发
      </button>
    );
  }

  return (
    <div className="cs-panel p-3 flex flex-wrap items-center gap-2">
      <input
        className="cs-input cs-mono text-xs"
        style={{ width: 130 }}
        placeholder="数据产品 ID"
        value={dataProductId}
        onChange={(e) => setDataProductId(e.target.value)}
      />
      <input
        className="cs-input"
        style={{ width: 120 }}
        placeholder="使用方"
        value={consumerId}
        onChange={(e) => setConsumerId(e.target.value)}
      />
      <select className="cs-input" style={{ width: 180 }} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
        {PURPOSES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <select className="cs-input" style={{ width: 110 }} value={retention} onChange={(e) => setRetention(e.target.value)}>
        {RETENTIONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <select className="cs-input" style={{ width: 120 }} value={output} onChange={(e) => setOutput(e.target.value)}>
        {OUTPUTS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <button className="cs-btn" disabled={!dataProductId || !consumerId} onClick={submit}>
        确认签发
      </button>
      <button className="cs-btn" style={{ opacity: 0.7 }} onClick={() => setOpen(false)}>
        取消
      </button>
      {msg && <span className="cs-label" style={{ whiteSpace: "nowrap" }}>{msg}</span>}
    </div>
  );
}
