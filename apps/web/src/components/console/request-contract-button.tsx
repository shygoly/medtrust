"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSignature, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";
import { participantLabel } from "@/lib/federated-tasks";
import {
  ARTIFACT_CLASS_LABEL,
  OUTPUT_PRESET_OPTIONS,
  buildOutputPolicyView,
  labelFromPreset,
  type OutputPreset,
} from "@/lib/output-policy";

const PURPOSES = [
  "胰岛素暴露·胰腺炎信号演示研究",
  "药物警戒 / 上市后安全性监测",
  "信号探查 / 队列分析",
  "肾内科病历文本 RWE",
];

const RETENTIONS = ["阅后即焚", "结果留存 30 天", "结果留存 90 天"];

type Props = {
  dataProductId?: string;
  providerId?: string;
  /** 预填的合规预审组合 ID（来自「合规预审」页「用此预审申请合约」，D-CMP-2）。 */
  compositionId?: string;
  compact?: boolean;
};

/** Consumer-only: apply for a digital contract against a catalog data product. */
export function RequestContractButton({
  dataProductId: presetProductId,
  providerId: presetProviderId,
  compositionId: presetCompositionId,
  compact = false,
}: Props = {}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataProductId, setDataProductId] = useState(presetProductId ?? "");
  const [providerId, setProviderId] = useState(presetProviderId ?? "");
  const [compositionId, setCompositionId] = useState(presetCompositionId ?? "");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [retention, setRetention] = useState(RETENTIONS[0]);
  const [preset, setPreset] = useState<OutputPreset>("aggregate_and_model");
  const [minCell, setMinCell] = useState(5);
  const [showGate, setShowGate] = useState(false);
  const [validDays, setValidDays] = useState(90);
  const [msg, setMsg] = useState("");

  const policy = useMemo(() => buildOutputPolicyView(preset, minCell), [preset, minCell]);

  const { data: products } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.getDataAssets(),
    enabled: open && !presetProductId,
  });

  // 本方创建的合规预审（D-CMP-2）：申请合约必须引用其一。
  const { data: comps } = useQuery({
    queryKey: ["my-compositions"],
    queryFn: () => api.listMyCompositions(),
    enabled: open,
  });

  useEffect(() => {
    if (presetProductId) setDataProductId(presetProductId);
  }, [presetProductId]);

  useEffect(() => {
    if (presetCompositionId) setCompositionId(presetCompositionId);
  }, [presetCompositionId]);

  useEffect(() => {
    if (presetProviderId) setProviderId(presetProviderId);
  }, [presetProviderId]);

  useEffect(() => {
    if (!dataProductId || !products?.length) return;
    const p = (products as any[]).find((x) => x.id === dataProductId);
    if (p?.providerId) setProviderId(p.providerId);
  }, [dataProductId, products]);

  const submit = async () => {
    setMsg("提交中…");
    try {
      if (!getUser()?.participantId) throw new Error("未识别参与方身份，请重新登录");
      if (!dataProductId) throw new Error("请选择数据产品");
      if (!compositionId)
        throw new Error("请选择一份合规预审（先在「合规预审」页创建并裁决）");
      const r = await api.requestContract({
        dataProductId,
        compositionId,
        purpose,
        retention,
        output: labelFromPreset(preset),
        minCell: policy.minCell,
        outputPolicy: { preset, minCell: policy.minCell },
        validDays,
      });
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      setMsg(`已提交申请 ✓ ${String(r.id).slice(0, 8)}`);
      setOpen(false);
    } catch (e: any) {
      const text = String(e?.message || "请求错误");
      setMsg(
        text.includes("403") || text.includes("consumer")
          ? "失败: 需要以数据使用方（药企/研究院）账号登录"
          : `失败: ${text}`,
      );
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className={compact ? "cs-btn cs-btn-ghost text-xs" : "cs-btn"}
          onClick={() => setOpen(true)}
          title="申请使用该数据产品：提供方签发后才能编排任务"
        >
          {compact ? (
            <>
              <FileSignature size={13} /> 申请合约
            </>
          ) : (
            <>
              <Plus size={15} /> 申请数字合约
            </>
          )}
        </button>
        {msg && (
          <span className="cs-mono text-[0.65rem] max-w-[220px] text-right truncate" style={{ color: "var(--cs-cyan)" }}>
            {msg}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="cs-panel p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {presetProductId ? (
          <input
            className="cs-input cs-mono text-xs"
            style={{ width: 220 }}
            readOnly
            value={dataProductId}
            title="数据产品"
          />
        ) : (
          <select
            className="cs-input"
            style={{ width: 220 }}
            value={dataProductId}
            onChange={(e) => setDataProductId(e.target.value)}
          >
            <option value="">选择数据产品…</option>
            {(products as any[] | undefined)?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title ?? p.id}
              </option>
            ))}
          </select>
        )}
        <input
          className="cs-input text-xs"
          style={{ width: 140 }}
          readOnly
          value={providerId ? participantLabel(providerId) : "提供方"}
          title={providerId ? `提供方 ID：${providerId}` : "来自目录产品"}
        />
        <select
          className="cs-input"
          style={{ width: 230 }}
          value={compositionId}
          onChange={(e) => setCompositionId(e.target.value)}
          title="引用一份自己的合规预审（D-CMP-2）"
        >
          <option value="">选择合规预审…</option>
          {(comps as any[] | undefined)?.map((c) => (
            <option key={c.id} value={c.id}>
              预审 {String(c.id).slice(0, 8)} · {c.verdict ?? "未裁决"}
              {c.overallRisk ? ` · ${c.overallRisk}` : ""}
            </option>
          ))}
        </select>
        <select className="cs-input" style={{ width: 200 }} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
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
          title="出域预设"
        >
          {OUTPUT_PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="cs-input cs-mono"
          style={{ width: 72 }}
          type="number"
          min={1}
          value={validDays}
          onChange={(e) => setValidDays(Number(e.target.value) || 90)}
          title="有效期（天）"
        />
        <button type="button" className="cs-btn cs-btn-ghost text-xs" onClick={() => setShowGate((v) => !v)}>
          {showGate ? "收起闸门" : "闸门细则"}
        </button>
        <button
          className="cs-btn"
          disabled={!dataProductId || !compositionId}
          onClick={submit}
        >
          提交申请
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
            <span style={{ color: "var(--cs-faint)" }}>≥5 · ≤20</span>
          </label>
          <div style={{ color: "var(--cs-faint)" }}>
            行级/可识别数据永禁 · 差分隐私未启用（dp.mode=none）
          </div>
        </div>
      )}
    </div>
  );
}
