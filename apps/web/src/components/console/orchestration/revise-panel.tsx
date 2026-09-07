"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, Unlock, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { FreezeLabel } from "./field-freeze-marker";
import { api, RwsOrchestrationRecord, RwsAnalysisSubmission } from "@/api/client";
import {
  rwsReviseFormSchema,
  RwsReviseFormData,
  RWS_DESIGN_TYPES,
} from "@/lib/rws-protocol-schema";

/**
 * rws-study-protocol-spec Phase 3 / §6.4 — protocol revision UI.
 *
 * Shows the current protocol version + frozen state + protocol warnings,
 * and offers a "修订方案" (revise) action that opens an inline form to
 * create a new version (bumps protocolVersion, requires revisionReason,
 * resets frozenAt, drops existing assignments).
 *
 * The revise form reuses the zod analysis schema so field-level validation
 * matches the submit form. It's pre-filled with the current `task.analysis`
 * so the user edits what they need rather than re-entering everything.
 */
export function ProtocolVersionPanel({ task }: { task: RwsOrchestrationRecord }) {
  const [showRevise, setShowRevise] = useState(false);
  const consumerId = typeof window !== "undefined" ? getUserParticipantId() : null;
  const canRevise = task.consumerId === consumerId;

  return (
    <Panel className="p-6">
      <div className="cs-label mb-4">方案版本（rws-study-protocol-spec §1.2 / D1）</div>
      <dl className="space-y-3 text-sm">
        <div className="flex gap-3">
          <dt className="cs-label shrink-0 w-24">版本</dt>
          <dd className="cs-mono">v{task.protocolVersion ?? 1}</dd>
        </div>
        <div className="flex gap-3 items-center">
          <dt className="cs-label shrink-0 w-24">冻结状态</dt>
          <dd>
            {task.frozenAt ? (
              <span
                className="cs-chip"
                style={{ color: "var(--cs-amber)", borderColor: "var(--cs-amber)" }}
              >
                <Lock size={11} /> 已冻结 {new Date(task.frozenAt).toLocaleString("zh-CN")}
              </span>
            ) : (
              <span
                className="cs-chip"
                style={{ color: "var(--cs-green)", borderColor: "var(--cs-green)" }}
              >
                <Unlock size={11} /> 未冻结
              </span>
            )}
          </dd>
        </div>
        {task.revisionReason && (
          <div className="flex gap-3">
            <dt className="cs-label shrink-0 w-24">修订原因</dt>
            <dd>{task.revisionReason}</dd>
          </div>
        )}
        {task.revisedAt && (
          <div className="flex gap-3">
            <dt className="cs-label shrink-0 w-24">修订时间</dt>
            <dd className="cs-mono">{new Date(task.revisedAt).toLocaleString("zh-CN")}</dd>
          </div>
        )}
      </dl>

      {(task.protocolWarnings?.length ?? 0) > 0 && (
        <div
          className="mt-4 p-3 text-[0.72rem] space-y-1"
          style={{
            color: "var(--cs-amber)",
            border: "1px solid var(--cs-amber)",
          }}
        >
          <div className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={13} /> 方案告警
          </div>
          {task.protocolWarnings!.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      )}

      {canRevise && (
        <div className="mt-5">
          {!showRevise ? (
            <button
              className="cs-btn text-xs"
              onClick={() => setShowRevise(true)}
            >
              修订方案（新建版本）
            </button>
          ) : (
            <ReviseForm task={task} onCancel={() => setShowRevise(false)} />
          )}
        </div>
      )}
    </Panel>
  );
}

function ReviseForm({
  task,
  onCancel,
}: {
  task: RwsOrchestrationRecord;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RwsReviseFormData>({
    resolver: zodResolver(rwsReviseFormSchema) as never,
    defaultValues: {
      // Cast through the zod-inferred type — the shape is compatible except
      // for the `tte.outcome.type` enum narrowing (string vs union). The zod
      // resolver validates at submit time; the defaultValues just pre-fills.
      analysis: task.analysis as unknown as RwsReviseFormData["analysis"],
      revisionReason: "",
    },
    mode: "onBlur",
  });

  const onSubmit = handleSubmit(async (data) => {
    setMsg("提交中…");
    try {
      await api.reviseRwsTask(task.taskId, {
        // Cast through unknown — the zod-inferred shape is structurally
        // compatible with RwsAnalysisSubmission; only the optional/required
        // markers on `expression` differ between the two type systems.
        analysis: data.analysis as unknown as RwsAnalysisSubmission,
        revisionReason: data.revisionReason,
      });
      await queryClient.invalidateQueries({ queryKey: ["rws-task", task.taskId] });
      setMsg("已修订 ✓ 新版本已创建");
      onCancel();
    } catch (e: any) {
      setMsg(`失败: ${e?.message ?? "请求错误"}`);
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4 p-4" style={{ border: "1px solid var(--cs-line)" }}>
      <div className="cs-label">修订为新版本</div>
      <div>
        <FreezeLabel field="rationale">修订原因（必填，§1.2 留痕）</FreezeLabel>
        <textarea
          className="cs-input"
          rows={2}
          placeholder="说明本次修订的原因"
          {...register("revisionReason")}
        />
        {errors.revisionReason && (
          <span className="text-xs" style={{ color: "var(--cs-red)" }}>
            {errors.revisionReason.message as string}
          </span>
        )}
      </div>
      <div>
        <FreezeLabel field="designType">设计类型</FreezeLabel>
        <select className="cs-input" {...register("analysis.designType")}>
          <option value="">— 不变 —</option>
          {RWS_DESIGN_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {dt}
            </option>
          ))}
        </select>
      </div>
      <div>
        <FreezeLabel field="rationale">选型理由</FreezeLabel>
        <textarea
          className="cs-input"
          rows={2}
          {...register("analysis.rationale")}
        />
      </div>
      <div className="text-[0.72rem]" style={{ color: "var(--cs-amber)" }}>
        修订将丢弃现有分派并创建新版本（v{(task.protocolVersion ?? 1) + 1}），
        冻结状态重置直到下次派发。
      </div>
      <div className="flex gap-2">
        <button type="submit" className="cs-btn text-xs">
          确认修订
        </button>
        <button type="button" className="cs-btn text-xs" onClick={onCancel}>
          取消
        </button>
        {msg && (
          <span className="text-xs self-center" style={{ color: "var(--cs-dim)" }}>
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}

// Avoid a circular import: read the user lazily from localStorage.
function getUserParticipantId(): string | null {
  try {
    const raw = localStorage.getItem("medtrust_user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { participantId?: string };
    return u.participantId ?? null;
  } catch {
    return null;
  }
}
