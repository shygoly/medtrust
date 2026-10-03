"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Panel } from "@/components/console/ui";
import { api } from "@/api/client";
import type { C3InterpretPayload } from "@/lib/c3-interpret-payload";

/**
 * 结果解读（AGT-04）：把已发布的聚合结果交给**自托管**推理端点生成解读草稿。
 * 左列是服务端确定性算出的事实清单，右列是模型措辞——研究者可逐条对照。
 */
export function ResultInterpretationPanel({ payload }: { payload: C3InterpretPayload }) {
  const [question, setQuestion] = useState("");
  const interpret = useMutation({
    mutationFn: () => api.interpretC3Result(question.trim(), payload),
  });
  const out = interpret.data;

  return (
    <Panel>
      <h3 className="text-sm mb-2" style={{ color: "var(--cs-dim)" }}>
        结果解读（自托管推理 · 草稿）
      </h3>
      <div className="flex gap-2 items-center">
        <input
          className="cs-input flex-1"
          placeholder="研究问题，例如：暴露与结局的关联"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="button"
          className="cs-navlink justify-center gap-2"
          style={{ borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" }}
          disabled={interpret.isPending || !question.trim()}
          onClick={() => interpret.mutate()}
        >
          <Sparkles size={16} />
          {interpret.isPending ? "推理中…" : "生成解读"}
        </button>
      </div>

      {interpret.isError ? (
        <p className="text-xs mt-3" style={{ color: "var(--cs-red)" }}>
          解读失败：{(interpret.error as Error)?.message}
        </p>
      ) : null}

      {out ? (
        <div className="grid grid-cols-2 gap-4 mt-3">
          <div>
            <p className="text-[0.7rem] mb-1" style={{ color: "var(--cs-dim)" }}>
              事实清单（服务端计算）
            </p>
            <ul className="text-[0.75rem] space-y-1 font-mono">
              {out.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[0.7rem] mb-1" style={{ color: "var(--cs-amber)" }}>
              {out.label}
            </p>
            <p className="text-sm leading-relaxed">{out.draft}</p>
            <p className="text-[0.7rem] mt-2 font-mono" style={{ color: "var(--cs-dim)" }}>
              {out.vendor} · {out.model} · {out.generatedAt}
            </p>
          </div>
        </div>
      ) : null}

      <p className="text-[0.7rem] mt-3" style={{ color: "var(--cs-dim)" }}>
        如实说明：只把上面这份已发布的聚合结果送给平台自运维的推理服务，不调用任何外部 AI 供应商；
        数值由服务端计算，模型只负责措辞，输出里出现清单之外的数字会被拒绝展示。
      </p>
    </Panel>
  );
}
