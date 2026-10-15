"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/console/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";
import {
  addStage,
  emptyPlanDraft,
  fromTemplatePlan,
  planHints,
  removeStage,
  stageIdHint,
  toPlanPayload,
  type PlanDraft,
} from "@/lib/plan-draft";

const TEMPLATES = [
  { id: "rws.cohort-count", label: "队列规模" },
  { id: "rws.condition-prevalence", label: "现患" },
  { id: "rws.adverse-event-signal", label: "不良反应信号" },
  { id: "rws.comparative-effect", label: "比较效果" },
  { id: "rws.causal-psm", label: "倾向评分" },
  { id: "rws.causal-survival", label: "生存分析" },
  { id: "rws.algorithm-validation", label: "算法校验" },
] as const;

function wizardSeed(): string {
  const now = new Date();
  const user = typeof window === "undefined" ? null : getUser();
  return JSON.stringify(
    {
      purpose: "",
      applicant: {
        org: user?.participantId ?? user?.email ?? "",
        project: "",
      },
      contracts: [],
      holders: [{ participantId: "", dataProductId: "" }],
      notBefore: now.toISOString(),
      notAfter: new Date(now.getTime() + 30 * 24 * 3600_000).toISOString(),
    },
    null,
    2,
  );
}

export default function ComposePage() {
  const [draft, setDraft] = useState<PlanDraft>(() => emptyPlanDraft());
  const [analysisKey, setAnalysisKey] = useState("rws.cohort-count");
  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0].id);
  const [wizardJson, setWizardJson] = useState("");
  const [newStageId, setNewStageId] = useState("");
  const [notice, setNotice] = useState("");
  const [serverReason, setServerReason] = useState("");
  const [pending, setPending] = useState(false);
  const [paramText, setParamText] = useState<Record<string, string>>({});

  const hints = useMemo(() => {
    const next = planHints(draft);
    if (!analysisKey.trim()) next.push("分析类型（analysisKey）未填，后端无法归属通道");
    const seen = new Set<string>();
    for (const stage of draft.stages) {
      if (!stage.id) continue;
      if (seen.has(stage.id)) next.push(`阶段 id 重复：${stage.id}`);
      seen.add(stage.id);
    }
    for (const stage of draft.stages) {
      const raw = paramText[stage.id];
      if (raw !== undefined) {
        try {
          JSON.parse(raw);
        } catch {
          next.push(`阶段 ${stage.id} 的参数不是 JSON`);
        }
      }
    }
    return next;
  }, [analysisKey, draft, paramText]);

  const loadWizard = async () => {
    setPending(true);
    setServerReason("");
    setNotice("");
    try {
      const raw = wizardJson.trim() ? wizardJson : wizardSeed();
      if (!wizardJson.trim()) setWizardJson(raw);
      const input = JSON.parse(raw) as unknown;
      const plan = await api.previewMdopPlan(templateId, input);
      const loaded = fromTemplatePlan(plan);
      if (!loaded) {
        setNotice("这份模板产出不可编辑");
        return;
      }
      setDraft(loaded);
      setAnalysisKey(templateId);
      setParamText(
        Object.fromEntries(loaded.stages.map((stage) => [stage.id, JSON.stringify(stage.params, null, 2)])),
      );
      setNotice("模板产出已放进编辑器，之后与手改同一份计划");
    } catch (err) {
      setServerReason(err instanceof Error ? err.message : "模板展开失败");
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    setPending(true);
    setServerReason("");
    setNotice("");
    try {
      const payload = { ...toPlanPayload(draft), analysisKey };
      const job = await api.submitMdopJob(payload);
      setNotice(`已提交作业 ${job.jobId}`);
    } catch (err) {
      setServerReason(err instanceof Error ? err.message : "提交被拒绝");
    } finally {
      setPending(false);
    }
  };

  const idHint = stageIdHint(draft, newStageId);

  return (
    <div>
      <PageHeader
        kicker="PLAN · 逻辑计划"
        desc="向导和手改写的是同一份计划。页面上的句子只是提示；缺合约、重名阶段或未注册算子，仍由后端拒绝。"
        action={
          <Link href="/space/atlas/pre-review" className="cs-btn cs-btn-ghost">
            合规预审
          </Link>
        }
      />
      <div className="p-8 space-y-6">
        <section className="space-y-3" style={{ background: "var(--cs-bg-2)" }}>
          <div className="cs-label">模板向导</div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="cs-btn cs-btn-ghost"
                data-on={templateId === template.id}
                onClick={() => setTemplateId(template.id)}
              >
                {template.label}
              </button>
            ))}
          </div>
          <Label className="cs-label">模板入参（JSON）</Label>
          <textarea
            className="cs-mono w-full min-h-36 text-sm p-3"
            style={{ background: "var(--cs-bg)", color: "var(--cs-fg)" }}
            value={wizardJson}
            placeholder="留空则用一份空白入参；展开后可继续改阶段"
            onChange={(event) => setWizardJson(event.target.value)}
          />
          <Button type="button" disabled={pending} onClick={() => void loadWizard()}>
            放入编辑器
          </Button>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Field label="用途" value={draft.purpose} onChange={(purpose) => setDraft({ ...draft, purpose })} />
          <Field
            label="分析类型"
            value={analysisKey}
            onChange={setAnalysisKey}
          />
          <Field
            label="申请机构"
            value={draft.applicant.org}
            onChange={(org) => setDraft({ ...draft, applicant: { ...draft.applicant, org } })}
          />
          <Field
            label="课题"
            value={draft.applicant.project}
            onChange={(project) => setDraft({ ...draft, applicant: { ...draft.applicant, project } })}
          />
          <Field
            label="合约（逗号分隔）"
            value={draft.contracts.join(", ")}
            onChange={(value) =>
              setDraft({
                ...draft,
                contracts: value.split(",").map((item) => item.trim()).filter(Boolean),
              })
            }
          />
          <Field
            label="伦理批件"
            value={draft.ethicsRef ?? ""}
            onChange={(ethicsRef) => setDraft({ ...draft, ...(ethicsRef ? { ethicsRef } : { ethicsRef: undefined }) })}
          />
          <Field label="开始" value={draft.notBefore} onChange={(notBefore) => setDraft({ ...draft, notBefore })} />
          <Field label="结束" value={draft.notAfter} onChange={(notAfter) => setDraft({ ...draft, notAfter })} />
        </section>

        <section className="space-y-3">
          <div className="cs-label">阶段</div>
          {draft.stages.map((stage, index) => (
            <div key={`${stage.id}-${index}`} className="space-y-2 p-3" style={{ background: "var(--cs-bg-2)" }}>
              <div className="grid gap-2 md:grid-cols-4">
                <Field
                  label="阶段 id"
                  value={stage.id}
                  onChange={(id) => {
                    const stages = draft.stages.slice();
                    stages[index] = { ...stage, id };
                    setDraft({ ...draft, stages });
                  }}
                />
                <Field
                  label="算子"
                  value={stage.op}
                  onChange={(op) => {
                    const stages = draft.stages.slice();
                    stages[index] = { ...stage, op };
                    setDraft({ ...draft, stages });
                  }}
                />
                <Field
                  label="输入（逗号分隔）"
                  value={stage.inputs.map((input) => input.from).join(", ")}
                  onChange={(value) => {
                    const stages = draft.stages.slice();
                    stages[index] = {
                      ...stage,
                      inputs: value.split(",").map((item) => item.trim()).filter(Boolean).map((from) => ({ from })),
                    };
                    setDraft({ ...draft, stages });
                  }}
                />
                <Field
                  label="放置 at"
                  value={stage.at ?? ""}
                  onChange={(at) => {
                    const stages = draft.stages.slice();
                    stages[index] = { ...stage, ...(at ? { at } : { at: undefined }) };
                    setDraft({ ...draft, stages });
                  }}
                />
              </div>
              <textarea
                className="cs-mono w-full min-h-20 text-sm p-2"
                style={{ background: "var(--cs-bg)", color: "var(--cs-fg)" }}
                value={paramText[stage.id] ?? JSON.stringify(stage.params, null, 2)}
                onChange={(event) => {
                  const text = event.target.value;
                  setParamText((prev) => ({ ...prev, [stage.id]: text }));
                  try {
                    const params = JSON.parse(text) as Record<string, unknown>;
                    const stages = draft.stages.slice();
                    stages[index] = { ...stage, params };
                    setDraft({ ...draft, stages });
                  } catch {
                    // 解析失败只留在提示里，不改已经放进计划的参数。
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const removed = removeStage(draft, stage.id);
                  setDraft(removed.draft);
                  setNotice(
                    removed.danglingRefs.length
                      ? `这些阶段仍引用 ${stage.id}：${removed.danglingRefs.join("、")}`
                      : "",
                  );
                }}
              >
                删除阶段
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="新阶段 id" value={newStageId} onChange={setNewStageId} />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (idHint) setNotice(idHint);
                if (!newStageId.trim()) return;
                setDraft(
                  addStage(draft, {
                    id: newStageId.trim(),
                    op: "",
                    inputs: [],
                    params: {},
                  }),
                );
                setNewStageId("");
              }}
            >
              添加阶段
            </Button>
          </div>
          {newStageId && idHint && <p className="text-sm" style={{ color: "var(--cs-dim)" }}>{idHint}</p>}
        </section>

        {hints.length > 0 && (
          <ul className="text-sm space-y-1" style={{ color: "var(--cs-dim)" }}>
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        )}
        {notice && <p className="text-sm">{notice}</p>}
        {serverReason && (
          <p className="text-sm" style={{ color: "var(--cs-red)" }}>
            后端拒绝：{serverReason}
          </p>
        )}
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? "提交中…" : "提交作业"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="cs-label">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
