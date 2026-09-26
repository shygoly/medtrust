"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { CKD_PURPOSE, coreSecretFlowSpec } from "@medtrust/demo-scenario";
import { api } from "@/api/client";

type Props = {
  dataProductId?: string;
  title?: string;
};

/**
 * @deprecated Demo-only SecretFlow shortcut. Do NOT wire into /space/catalog —
 * catalog is metadata; training/compute requires an active digital contract +
 * orchestration task (see RequestContractButton → /space/tasks/new).
 */
// 训练数据由各院连接器按合约的数据产品投影提供,任务里不再指定院内目录(omop-data-source-access 4.3)。
export function TrainProductButton({ dataProductId = "dp-insulin-panc-huashan", title }: Props) {
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
        parties: coreSecretFlowSpec().parties.filter(
          (p) =>
            p.participantId === "pharma-demo" ||
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
          consumerId: "pharma-demo",
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
        profiles: [
          // 如实声明:线上 agent 为 CPU、无硬件 TEE(见 use-secretflow-orchestration DEFAULT_PROFILES)
          { participantId: "hospital-huashan", device: "CPU", hasTee: false },
          { participantId: "hospital-ruijin", device: "CPU", hasTee: false },
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
        disabled={busy}
        onClick={run}
        title={title ? `用合约数据产品 ${dataProductId} 训练: ${title}` : undefined}
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
