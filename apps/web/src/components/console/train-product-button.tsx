"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { CKD_PURPOSE, coreSecretFlowSpec } from "@medtrust/demo-scenario";
import { api } from "@/api/client";

type Props = {
  dataPath: string;
  dataProductId?: string;
  title?: string;
};

/** Provider demo: dispatch SecretFlow training on connector-local Synthea path. */
export function TrainProductButton({ dataPath, dataProductId = "dp-ckd-ehr", title }: Props) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setMsg("签约并派发…");
    try {
      const taskId = `catalog-fl-${Date.now()}`;
      const spec = {
        ...coreSecretFlowSpec(),
        epochs: 2,
        modalities: [{ type: "structured_ehr", dataProductId }],
        dataPath,
        parties: coreSecretFlowSpec().parties.filter(
          (p) =>
            p.participantId === "pharma-hengrui" ||
            p.participantId === "hospital-huashan" ||
            p.participantId === "hospital-ruijin",
        ),
      };
      const providers = ["hospital-huashan", "hospital-ruijin"];
      const contractIds: string[] = [];
      for (const providerId of providers) {
        const c: any = await api.createContract({
          dataProductId,
          providerId,
          consumerId: "pharma-hengrui",
          purpose: CKD_PURPOSE,
          retention: "burn-after-read",
          output: "aggregate",
          validDays: 30,
        } as any);
        contractIds.push(c.id);
      }
      setMsg("训练中…");
      const dispatch: any = await api.orchestrateSecretFlow({
        taskId,
        spec,
        dataPath,
        profiles: [
          {
            participantId: "hospital-huashan",
            device: "H100",
            hasTee: true,
            hasConfidentialGpu: true,
            gpuMemoryGb: 80,
          },
          { participantId: "hospital-ruijin", device: "V100", hasTee: false },
        ],
        contractIds,
        purpose: CKD_PURPOSE,
        budget: { amount: 100, currency: "CNY" },
      });
      for (let i = 0; i < 40; i++) {
        const st: any = await api.getSecretFlowTask(taskId);
        if (st.state === "COMPLETED" || st.state === "FAILED" || st.state === "REFUSED") {
          if (st.state !== "COMPLETED") throw new Error(st.state + (st.error ? `: ${st.error}` : ""));
          const res: any = await api.getSecretFlowResult(taskId);
          const fed = res.metrics?.federatedConnectors?.join("+") ?? "华山+瑞金";
          setMsg(`联邦 LoRA ✓ ${String(res.loraDeltaHash ?? "").slice(0, 20)} · ${fed}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setMsg(`已派发 ${dispatch.state} · 任务 ${taskId.slice(0, 8)}…`);
    } catch (e: any) {
      setMsg("失败: " + (e?.message || "请求错误"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="cs-btn cs-btn-ghost text-xs"
        disabled={busy || !dataPath}
        onClick={run}
        title={title ? `用 ${dataPath} 训练: ${title}` : undefined}
      >
        <Play size={13} /> {busy ? "训练中…" : "连接器训练"}
      </button>
      {msg && (
        <span className="cs-mono text-[0.65rem] max-w-[220px] text-right truncate" style={{ color: "var(--cs-cyan)" }}>
          {msg}
        </span>
      )}
    </div>
  );
}
