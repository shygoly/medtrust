"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";

const PURPOSES = [
  "CKD 多中心疗效真实世界研究",
  "肾内科病历文本 RWE",
  "药物警戒 / 上市后安全性监测",
  "信号探查 / 队列分析",
];

const RETENTIONS = ["阅后即焚", "结果留存 30 天", "结果留存 90 天"];
const OUTPUTS = ["仅聚合统计", "仅模型增量", "聚合 + 模型参数"];

/** Consumer-only: apply for a digital contract against a catalog data product. */
export function RequestContractButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataProductId, setDataProductId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [retention, setRetention] = useState(RETENTIONS[0]);
  const [output, setOutput] = useState(OUTPUTS[0]);
  const [validDays, setValidDays] = useState(90);
  const [msg, setMsg] = useState("");

  const { data: products } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.getDataAssets(),
    enabled: open,
  });

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
      const r = await api.requestContract({
        dataProductId,
        purpose,
        retention,
        output,
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
      <button className="cs-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> 申请数字合约
      </button>
    );
  }

  return (
    <div className="cs-panel p-3 flex flex-wrap items-center gap-2">
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
      <input
        className="cs-input cs-mono text-xs"
        style={{ width: 120 }}
        readOnly
        value={providerId || "提供方"}
        title="来自目录产品"
      />
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
      <select className="cs-input" style={{ width: 130 }} value={output} onChange={(e) => setOutput(e.target.value)}>
        {OUTPUTS.map((o) => (
          <option key={o}>{o}</option>
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
      <button className="cs-btn" disabled={!dataProductId} onClick={submit}>
        提交申请
      </button>
      <button className="cs-btn" style={{ opacity: 0.7 }} onClick={() => setOpen(false)}>
        取消
      </button>
      {msg && <span className="cs-label" style={{ whiteSpace: "nowrap" }}>{msg}</span>}
    </div>
  );
}
