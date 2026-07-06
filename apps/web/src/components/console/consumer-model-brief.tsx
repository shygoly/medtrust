"use client";

import { CKD_MODEL_BRIEF, artifactLabel } from "@/lib/consumer-model-brief";
import { Panel } from "./ui";

type Props = {
  compact?: boolean;
};

/** Explains what the federated LoRA deliverable is for pharma / consumer users. */
export function ConsumerModelBrief({ compact }: Props) {
  const b = CKD_MODEL_BRIEF;
  if (compact) {
    return (
      <Panel className="p-5 text-sm space-y-2" style={{ color: "var(--cs-dim)" }}>
        <div className="font-medium" style={{ color: "var(--cs-text)" }}>
          {b.title}
        </div>
        <p>{b.backbone.description}</p>
        <p className="cs-mono text-xs" style={{ color: "var(--cs-cyan)" }}>
          {b.backbone.name} · {b.peft.type} r={b.peft.rank}
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="p-6">
        <div className="cs-label mb-2">MODEL · 交付模型说明</div>
        <h2 className="text-lg font-medium">{b.title}</h2>
        <p className="text-sm mt-2" style={{ color: "var(--cs-dim)" }}>
          研究目的 · {b.purposeLabel}（<span className="cs-mono text-xs">{b.purpose}</span>）
        </p>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel className="p-6">
          <div className="cs-label mb-3">基座与微调</div>
          <dl className="space-y-2 text-sm">
            <BriefRow k="基座模型" v={`${b.backbone.name} (${b.backbone.type})`} />
            <BriefRow k="微调方式" v={`${b.peft.type} · r=${b.peft.rank} · α=${b.peft.alpha}`} />
            <BriefRow k="目标模块" v={b.peft.targets.join(", ")} mono />
            <BriefRow k="数据模态" v={b.dataModalities.join(", ")} />
          </dl>
          <p className="text-sm mt-4" style={{ color: "var(--cs-dim)" }}>
            {b.backbone.description}
          </p>
          <p className="text-sm mt-2" style={{ color: "var(--cs-dim)" }}>
            {b.peft.description}
          </p>
        </Panel>

        <Panel className="p-6">
          <div className="cs-label mb-3">隐私与合约放行制品</div>
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            {b.privacy.summary}
          </p>
          <p className="text-sm mt-3" style={{ color: "var(--cs-dim)" }}>
            {b.dataNote}
          </p>
          <ul className="mt-4 space-y-1.5">
            {b.allowedArtifacts.map((a) => (
              <li key={a} className="cs-chip text-xs">
                {artifactLabel(a)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel className="p-6">
          <div className="cs-label mb-3">您可如何使用交付物</div>
          <ul className="space-y-2 text-sm list-disc pl-4" style={{ color: "var(--cs-dim)" }}>
            {b.intendedUse.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-6">
          <div className="cs-label mb-3">不包含(数据不出域)</div>
          <ul className="space-y-2 text-sm list-disc pl-4" style={{ color: "var(--cs-faint)" }}>
            {b.notIncluded.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function BriefRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="cs-label shrink-0 w-20">{k}</dt>
      <dd className={mono ? "cs-mono text-xs" : ""}>{v}</dd>
    </div>
  );
}
