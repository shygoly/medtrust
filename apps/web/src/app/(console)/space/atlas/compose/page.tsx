"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { codexFontVars } from "@/app/(console)/space/atlas/fonts";
import { api } from "@/api/client";
import { RequestContractButton } from "@/components/console/request-contract-button";
import {
  LAYER_ORDER,
  LAYER_META,
  type CapabilityLayer,
  type CapabilityObject,
  type ComplianceEvaluation,
} from "@/types/capability.types";
import { VerdictSeal } from "@/components/atlas/verdict-seal";
import { isLanded, landedFirst, landingNote, landingTitle } from "@/lib/capability-landing";
import { PageHeader } from "@/components/console/ui";

type AllLayers = Record<CapabilityLayer, CapabilityObject[]>;
const PICK_LAYERS: CapabilityLayer[] = ["l3_model", "l4_algorithm", "l5_operator", "l6_protocol", "l7_infrastructure"];

export default function ComposePage() {
  const { data } = useQuery({
    queryKey: ["atlas", "all"],
    queryFn: async (): Promise<AllLayers> => {
      const lists = await Promise.all(LAYER_ORDER.map((l) => api.listCapability(l)));
      return Object.fromEntries(LAYER_ORDER.map((l, i) => [l, lists[i]])) as AllLayers;
    },
  });

  const [scenarioKey, setScenarioKey] = useState("");
  const [picks, setPicks] = useState<Record<CapabilityLayer, Set<string>>>(
    () => Object.fromEntries(LAYER_ORDER.map((l) => [l, new Set<string>()])) as Record<CapabilityLayer, Set<string>>,
  );
  const [anonymizationKey, setAnon] = useState("adequate");
  const [kAnon, setKAnon] = useState(5);
  const [epsilon, setEpsilon] = useState(0.5);
  const [participantCount, setPc] = useState(3);
  const [genetic, setGenetic] = useState(false);
  const [crossBorder, setCross] = useState(false);
  const [nhcc, setNhcc] = useState(false);
  const [evaluation, setEvaluation] = useState<ComplianceEvaluation | null>(null);

  // 未落地对象不可选(fail-closed,见 lib/capability-landing)。
  const toggle = (layer: CapabilityLayer, o: CapabilityObject) => {
    if (!isLanded(o)) return;
    setPicks((p) => {
      const next = new Set(p[layer]);
      if (next.has(o.key)) next.delete(o.key);
      else next.add(o.key);
      return { ...p, [layer]: next };
    });
  };

  // 提交只带当前仍为已落地的选中项(注册表状态可能在选择后被运营方改动)。
  const chosen = (layer: CapabilityLayer) =>
    (data?.[layer] ?? []).filter((o) => isLanded(o) && picks[layer].has(o.key)).map((o) => o.key);

  const scenario = data?.l1_scenario.find((s) => s.key === scenarioKey);
  const scenarioNote = scenario ? landingNote(scenario) : undefined;

  const run = useMutation({
    mutationFn: async () => {
      const composition = await api.createComposition({
        scenarioKey,
        modelKeys: chosen("l3_model"),
        algorithmKeys: chosen("l4_algorithm"),
        operatorKeys: chosen("l5_operator"),
        protocolKeys: chosen("l6_protocol"),
        infraKeys: chosen("l7_infrastructure"),
        chosenParams: { anonymizationKey, kAnonymity: kAnon, epsilon },
        riskDimensions: {
          participantCount,
          humanGeneticResources: genetic,
          crossBorder,
          approvedByNHCC: nhcc,
          dataFlowChain: participantCount > 1 ? "cross" : "internal",
        },
      });
      return api.evaluateCompliance(composition.id);
    },
    onSuccess: (ev) => setEvaluation(ev),
  });

  return (
    <div>
      <PageHeader
        kicker="PRE-REVIEW · 组合方案的事前合规预审"
        desc="选定场景与各层系统对象,声明已选隐私参数与风险维度 → 由 L2 合规引擎裁决(批准 / 需审批 / 驳回)。裁决通过后可「用此预审申请合约」:裁决快照写入合约、随合约哈希存证,并在任务准入时按当前规则复核(D-CMP-2)。"
      />
      <div className="p-8">
      <div>
        <div className="flex flex-wrap items-center gap-5 text-xs" style={{ color: "var(--cs-dim)" }}>
          <span className="inline-flex items-center gap-1.5"><span className="cs-land-dot" data-landed="true" />已落地 · 可选</span>
          <span className="inline-flex items-center gap-1.5"><span className="cs-land-dot" data-landed="false" />未落地 · 不可选(悬停看缺口)</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_400px] gap-8 mt-6 items-start">
        <div className="space-y-6">
          <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
            <CardContent className="p-5">
              <div className="cs-label mb-2">L1 · 场景</div>
              <Select value={scenarioKey || undefined} onValueChange={(v) => { setScenarioKey(v); setEvaluation(null); }}>
                <SelectTrigger><SelectValue placeholder="选择场景…" /></SelectTrigger>
                <SelectContent className={cn(codexFontVars, "codex")}>
                  {landedFirst(data?.l1_scenario ?? []).map((s) => (
                    <SelectItem key={s.key} value={s.key} disabled={!isLanded(s)}>
                      <span className="inline-flex items-center gap-2">
                        <span className="cs-land-dot" data-landed={isLanded(s)} />
                        {s.name} — {s.riskLevel}
                        {!isLanded(s) && <span style={{ color: "var(--cs-red)" }}>· 未落地</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scenario && (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="cs-key">声明风险 · {scenario.riskLevel}</span>
                    <span className="text-xs" style={{ color: "var(--cs-faint)" }}>{scenario.description}</span>
                  </div>
                  {scenarioNote && (
                    <div className="mt-2 text-xs" style={{ color: "var(--cs-dim)" }}>落地依据 · {scenarioNote}</div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {PICK_LAYERS.map((l, i) => {
            const all = data?.[l] ?? [];
            const landedCount = all.filter(isLanded).length;
            return (
              <Card key={l} className="cs-reveal" style={{ animationDelay: `${60 + i * 50}ms`, background: "var(--cs-bg-2)" }}>
                <CardContent className="p-5">
                  <div className="cs-label mb-3">
                    {LAYER_META[l].n} · {LAYER_META[l].label}（已落地 {landedCount}/{all.length} · 选中 {chosen(l).length}）
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {landedFirst(all).map((o) => {
                      const landed = isLanded(o);
                      const on = landed && picks[l].has(o.key);
                      return (
                        <button
                          key={o.key}
                          type="button"
                          className="cs-land-chip"
                          data-landed={landed}
                          data-on={on}
                          aria-pressed={landed ? on : undefined}
                          aria-disabled={landed ? undefined : true}
                          title={landingTitle(o)}
                          onClick={() => toggle(l, o)}
                        >
                          <span className="cs-land-dot" data-landed={landed} />
                          {o.key}
                        </button>
                      );
                    })}
                    {all.length === 0 && <span className="text-sm" style={{ color: "var(--cs-faint)" }}>无</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
            <CardContent className="p-5">
              <div className="cs-label mb-3">已选隐私参数 · 风险维度</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="cs-label">匿名度 anonymization</Label>
                  <Select value={anonymizationKey} onValueChange={setAnon}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className={cn(codexFontVars, "codex")}>
                      <SelectItem value="partial">partial</SelectItem>
                      <SelectItem value="adequate">adequate</SelectItem>
                      <SelectItem value="complete">complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Param label="k-匿名" value={kAnon} onChange={setKAnon} />
                <Param label="ε-DP" value={epsilon} step="0.1" onChange={setEpsilon} />
                <Param label="参与方数" value={participantCount} onChange={setPc} />
              </div>
              <div className="flex flex-wrap gap-5 mt-4">
                <Check label="含人类遗传资源" v={genetic} on={setGenetic} />
                <Check label="已获 NHCC 审批" v={nhcc} on={setNhcc} />
                <Check label="数据跨境" v={crossBorder} on={setCross} />
              </div>
            </CardContent>
          </Card>

          <Button disabled={!scenario || !isLanded(scenario) || run.isPending} onClick={() => run.mutate()}>
            <Gavel size={16} /> {run.isPending ? "裁决中…" : "提交 L2 合规裁决"}
          </Button>
          {run.error && <Card className="p-3 text-sm" style={{ color: "var(--cs-red)", background: "var(--cs-bg-2)" }}>裁决失败:{(run.error as Error).message}</Card>}
        </div>

        <div className="lg:sticky lg:top-6">
          {evaluation ? (
            <div className="space-y-4">
              <VerdictSeal ev={evaluation} />
              {evaluation.autoVerdict !== "block" && evaluation.compositionId && (
                <Card style={{ background: "var(--cs-bg-2)" }}>
                  <CardContent className="p-4 space-y-2">
                    <div className="cs-label">用此预审申请合约</div>
                    <p className="text-xs" style={{ color: "var(--cs-faint)" }}>
                      选择数据产品并发起数字合约申请，本裁决将作为快照写入合约（D-CMP-2）。
                    </p>
                    <RequestContractButton
                      compositionId={evaluation.compositionId}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card className="grid place-items-center text-center" style={{ minHeight: 280, background: "var(--cs-bg-2)" }}>
              <CardContent className="p-7">
                <div className="cs-atlas-seal" style={{ opacity: 0.18, animation: "none", filter: "grayscale(1)" }}>
                  <div className="cs-atlas-seal-text">待裁决</div>
                </div>
                <p className="text-sm mt-4 max-w-[16rem] mx-auto" style={{ color: "var(--cs-faint)" }}>
                  完成组合后提交,L2 引擎将盖下批准 / 需审批 / 驳回之印。
                </p>
                <Link href="/space/tasks" className="cs-key inline-block mt-4">查看运行中的任务 →</Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function Param({ label, value, step, onChange }: { label: string; value: number; step?: string; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="cs-label">{label}</Label>
      <Input className="cs-mono" type="number" step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

function Check({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--cs-dim)" }}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}
