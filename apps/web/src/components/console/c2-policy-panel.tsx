"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

/**
 * 合约的 C2 证明策略（任务 7.1）。
 *
 * 这是**唯一**让一份合约允许「数据密文出域至可信空间节点」的入口，因此把两件事写在一起：
 *  ① 让操作者看清自己在改什么（链型 / 最低可信基 / 允许度量）；
 *  ② 一次**显式勾选**的风险确认——不许默认勾上。
 *
 * 提醒（与 TRUST P-CTL-8 / 协议 §4.5 一致）：开了 C2 不等于「数据还在医院」。
 * 它换的是信任锚（CPU 厂商证明根 + 代码度量 + 运营方 + KMS 释放策略），合规定性是**委托处理/数据出域**。
 */

const TEE_KINDS = [
  { key: "csv", label: "海光 CSV", hint: "信创/国产化要求下优先" },
  { key: "tdx", label: "Intel TDX", hint: "云上机密机型生态较成熟" },
  { key: "sev-snp", label: "AMD SEV-SNP", hint: "云上机密机型另一选择" },
];

export function C2PolicyPanel({ contractId }: { contractId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [minTcb, setMinTcb] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const describe = useQuery({
    queryKey: ["mdop-contract", contractId],
    queryFn: () => api.describeMdopContract(contractId),
    retry: false,
  });
  const currentPolicy = (describe.data?.contract as { attestation_policy?: unknown } | undefined)
    ?.attestation_policy;

  const offer = useMutation({
    mutationFn: () =>
      api.offerMdopContract(contractId, {
        attestationPolicy: {
          tee: selected,
          ...(minTcb.trim() ? { minTcb: minTcb.trim() } : {}),
          ...(measurements.trim()
            ? { allowedMeasurements: measurements.split(/[\s,]+/).filter(Boolean) }
            : {}),
        },
      }),
    onSuccess: (r) => {
      setMsg(`已重新发起要约（含证明策略）：${r.offerId}。条款已变，各院需重新签署。`);
      void qc.invalidateQueries({ queryKey: ["mdop-contract", contractId] });
      void qc.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (e) => setMsg(`发起失败：${(e as Error).message}`),
  });

  return (
    <div
      className="mt-2 rounded p-3 text-[0.75rem] space-y-2"
      style={{ border: "1px solid var(--cs-line)", background: "var(--cs-bg-2)" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--cs-amber)" }}>C2 · 可信空间节点</span>
        <span style={{ color: "var(--cs-dim)" }}>
          {currentPolicy
            ? `当前条款已声明证明策略：${JSON.stringify(currentPolicy)}`
            : "当前条款未声明证明策略 —— 该合约不允许任何节点接收 C2"}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {TEE_KINDS.map((k) => (
          <label key={k.key} className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.includes(k.key)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, k.key] : prev.filter((x) => x !== k.key),
                )
              }
            />
            <span>{k.label}</span>
            <span style={{ color: "var(--cs-faint)" }}>（{k.hint}）</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="inline-flex items-center gap-1.5">
          <span style={{ color: "var(--cs-dim)" }}>最低可信基（按链写，如 tdx=3.1.2）</span>
          <input
            className="cs-input w-56"
            value={minTcb}
            onChange={(e) => setMinTcb(e.target.value)}
            placeholder="如 3.1.2 或 csv=2026-06,tdx=3.1.2"
          />
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span style={{ color: "var(--cs-dim)" }}>允许的代码度量（可留空＝只按注册中心白名单）</span>
          <input
            className="cs-input w-72"
            value={measurements}
            onChange={(e) => setMeasurements(e.target.value)}
            placeholder="sm3:..."
          />
        </label>
      </div>

      <label className="flex items-start gap-2">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span style={{ color: "var(--cs-amber)" }}>
          我确认：开启后该合约允许**数据以密文出域**至可信空间节点执行。这**不等于**「数据仍在医院」——
          它把信任锚换成「CPU 厂商证明根 + 代码度量 + 节点运营方 + 密钥释放策略」，合规定性变为委托处理/数据出域，
          且内存访问模式侧信道不在 TDX/SEV-SNP 防护范围内。运营方须为中立第三方或监管侧，KMS 由持有方自建或共管。
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          className="cs-navlink text-xs"
          disabled={!ack || selected.length === 0 || offer.isPending}
          onClick={() => offer.mutate()}
          style={{
            borderColor: ack && selected.length ? "var(--cs-cyan)" : "var(--cs-line)",
            color: ack && selected.length ? "var(--cs-cyan)" : "var(--cs-faint)",
          }}
        >
          {offer.isPending ? "发起中…" : "带证明策略重新发起 MDOP 要约"}
        </button>
        {msg ? <span style={{ color: "var(--cs-dim)" }}>{msg}</span> : null}
      </div>
    </div>
  );
}
