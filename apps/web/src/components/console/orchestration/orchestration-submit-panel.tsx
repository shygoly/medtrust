import Link from "next/link";
import { explainSubmitError } from "@/lib/submit-error";

export function OrchestrationSubmitPanel({
  disabled,
  onSubmit,
  msg,
  error,
  taskId,
  taskHref,
  submitLabel = "提交任务 · 校验授权",
}: {
  disabled?: boolean;
  onSubmit: () => void;
  msg: string;
  /** 提交被拒的原因（原文）；面板负责翻成「原因 + 下一步」。 */
  error?: string;
  taskId?: string;
  taskHref?: string;
  submitLabel?: string;
}) {
  const hint = error ? explainSubmitError(error) : null;
  return (
    <>
      <button
        className="cs-btn w-full justify-center mt-5"
        disabled={disabled}
        onClick={onSubmit}
        type="button"
      >
        {submitLabel}
      </button>
      {msg && (
        <div className="cs-mono text-[0.7rem] mt-3 text-center" style={{ color: "var(--cs-cyan)" }}>
          {msg}
        </div>
      )}
      {hint && (
        <div
          className="mt-3 p-3 text-xs"
          style={{ border: "1px solid var(--cs-red)", color: "var(--cs-red)" }}
        >
          <div className="font-medium">{hint.title}</div>
          <div className="mt-1" style={{ color: "var(--cs-dim)" }}>
            {hint.detail}
          </div>
          {hint.action && (
            <Link href={hint.action.href} className="cs-btn cs-btn-ghost text-xs inline-flex mt-2">
              {hint.action.label}
            </Link>
          )}
        </div>
      )}
      {taskId && taskHref && (
        <Link href={taskHref} className="block text-center text-xs mt-2" style={{ color: "var(--cs-cyan)" }}>
          查看任务 {taskId.slice(0, 8)}…
        </Link>
      )}
    </>
  );
}
