"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ComplianceEvaluation, Verdict } from "@/types/capability.types";

const SEAL: Record<Verdict, { mark: "approve" | "manual" | "block"; zh: string; en: string }> = {
  auto_approve: { mark: "approve", zh: "批准", en: "APPROVED" },
  manual_review: { mark: "manual", zh: "需审批", en: "MANUAL REVIEW" },
  block: { mark: "block", zh: "驳回", en: "BLOCKED" },
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b" style={{ borderColor: "var(--cs-line-soft)" }}>
      <span className="cs-label">{label}</span>
      <span className="cs-mono text-sm text-right" style={{ color: "var(--cs-text)" }}>{value}</span>
    </div>
  );
}

export function VerdictSeal({ ev }: { ev: ComplianceEvaluation }) {
  const seal = SEAL[ev.autoVerdict];
  const req = ev.required ?? {};
  return (
    <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
      <CardContent className="p-7">
        <div className="flex items-start gap-7">
          <div className="shrink-0 grid place-items-center" style={{ minWidth: 150 }}>
            <div className="cs-atlas-seal" data-verdict={seal.mark} key={ev.id}>
              <div className="cs-atlas-seal-text">
                {seal.zh}
                <div className="cs-label mt-1" style={{ fontSize: "0.44rem", letterSpacing: "0.2em", color: "inherit", opacity: 0.85 }}>
                  {seal.en}
                </div>
              </div>
            </div>
            <div className="cs-label mt-3">L2 裁决 · 风险 {ev.overallRisk}</div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="cs-label mb-2">REQUIRED · 合规要求</div>
            <Row label="匿名度" value={req.anonymization ?? "—"} />
            <Row label="k-匿名" value={req.kAnonymity ?? "—"} />
            <Row label="l-多样性" value={req.lDiversity ?? "—"} />
            <Row label="ε-DP" value={req.epsilon ?? "—"} />
            <Row label="保障级" value={req.securityCapability ?? "—"} />
            <Row label="需审批" value={req.approvalRequired ? "是" : "否"} />
          </div>
        </div>

        {ev.blockingRulesMatched.length > 0 && (
          <div className="mt-5">
            <div className="cs-label mb-2" style={{ color: "var(--cs-red)" }}>BLOCKING RULES · 命中阻断</div>
            <div className="flex flex-wrap gap-2">
              {ev.blockingRulesMatched.map((r) => (
                <Badge key={r} variant="destructive" className="cs-mono font-normal">{r}</Badge>
              ))}
            </div>
          </div>
        )}

        {ev.warnings.length > 0 && (
          <div className="mt-5">
            <div className="cs-label mb-2" style={{ color: "var(--cs-amber)" }}>WARNINGS · 警告</div>
            <ul className="space-y-1">
              {ev.warnings.map((w, i) => <li key={i} className="text-sm" style={{ color: "var(--cs-dim)" }}>· {w}</li>)}
            </ul>
          </div>
        )}

        {ev.structuralIssues.length > 0 && (
          <div className="mt-5">
            <div className="cs-label mb-2">STRUCTURAL · 结构提示</div>
            <ul className="space-y-1">
              {ev.structuralIssues.map((s, i) => <li key={i} className="text-sm" style={{ color: "var(--cs-faint)" }}>· {s}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
