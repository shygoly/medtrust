"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";
import {
  ARTIFACT_CLASS_LABEL,
  OUTPUT_PRESET_OPTIONS,
  buildOutputPolicyView,
  labelFromPreset,
  type OutputPreset,
} from "@/lib/output-policy";

const PURPOSES = ["CKD 多中心疗效真实世界研究", "肾内科病历文本 RWE", "院内授权联调"];
const RETENTIONS = ["阅后即焚", "结果留存 90 天"];

/** Provider-only: directly issue an active contract (skip consumer request). */
export function IssueContractButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataProductId, setDataProductId] = useState("");
  const [consumerId, setConsumerId] = useState("p-meddata");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [retention, setRetention] = useState(RETENTIONS[0]);
  const [preset, setPreset] = useState<OutputPreset>("aggregate_only");
  const [minCell, setMinCell] = useState(5);
  const [showGate, setShowGate] = useState(false);
  const [validDays, setValidDays] = useState(90);
  const [msg, setMsg] = useState("");

  const policy = useMemo(() => buildOutputPolicyView(preset, minCell), [preset, minCell]);

  // 数据产品从本机构已发布的目录里选，不再手填 ID。
  const { data: products } = useQuery({ queryKey: ["catalog"], queryFn: () => api.getDataAssets(), enabled: open });
  const participantId = getUser()?.participantId;
  const ownProducts = ((products as any[] | undefined) ?? []).filter((p) => p.providerId === participantId);
  const selectedProductId = dataProductId || ownProducts[0]?.id || "";

  const submit = async () => {
    setMsg("签发中…");
    try {
      const user = getUser();
      if (!user?.participantId) throw new Error("未识别参与方身份");
      if (!selectedProductId) throw new Error("本机构暂无已发布的数据产品，请先在「本院连接器」发布");
      const r = await api.issueContract({
        dataProductId: selectedProductId,
        providerId: user.participantId,
        consumerId,
        purpose,
        retention,
        output: labelFromPreset(preset),
        minCell: policy.minCell,
        outputPolicy: { preset, minCell: policy.minCell },
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
    <div className="cs-panel p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="cs-input text-xs"
          style={{ width: 200 }}
          aria-label="数据产品"
          value={selectedProductId}
          onChange={(e) => setDataProductId(e.target.value)}
        >
          {ownProducts.length === 0 && <option value="">本机构暂无已发布的数据产品</option>}
          {ownProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title ?? p.id}
            </option>
          ))}
        </select>
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
        <select
          className="cs-input"
          style={{ width: 150 }}
          value={preset}
          onChange={(e) => setPreset(e.target.value as OutputPreset)}
        >
          {OUTPUT_PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="cs-btn cs-btn-ghost text-xs" onClick={() => setShowGate((v) => !v)}>
          {showGate ? "收起闸门" : "闸门细则"}
        </button>
        <button className="cs-btn" disabled={!dataProductId || !consumerId} onClick={submit}>
          确认签发
        </button>
        <button className="cs-btn" style={{ opacity: 0.7 }} onClick={() => setOpen(false)}>
          取消
        </button>
        {msg && (
          <span className="cs-label" style={{ whiteSpace: "nowrap" }}>
            {msg}
          </span>
        )}
      </div>
      {showGate && (
        <div
          className="rounded-md px-3 py-2 text-[0.72rem] space-y-1.5"
          style={{ border: "1px solid var(--cs-line)", color: "var(--cs-dim)" }}
        >
          <div>
            允许制品：
            {policy.allowedArtifacts.map((a) => ARTIFACT_CLASS_LABEL[a]).join(" · ")}
          </div>
          <label className="flex items-center gap-2">
            <span>小单元格阈值 minCell</span>
            <input
              className="cs-input cs-mono"
              style={{ width: 64 }}
              type="number"
              min={5}
              max={20}
              value={minCell}
              onChange={(e) => setMinCell(Number(e.target.value) || 5)}
            />
          </label>
          <div style={{ color: "var(--cs-faint)" }}>行级永禁 · DP 未启用</div>
        </div>
      )}
    </div>
  );
}
