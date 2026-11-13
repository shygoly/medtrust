import Link from "next/link";

export function OrchestrationSubmitPanel({
  disabled,
  onSubmit,
  msg,
  taskId,
  taskHref,
  submitLabel = "提交任务 · 校验授权",
}: {
  disabled?: boolean;
  onSubmit: () => void;
  msg: string;
  taskId?: string;
  taskHref?: string;
  submitLabel?: string;
}) {
  return (
    <>
      <button
        className="cs-btn w-full justify-center mt-5"
        disabled={disabled}
        onClick={onSubmit}
        type="button"
        title={disabled ? "请先选择至少一份已持签数字合约" : undefined}
      >
        {submitLabel}
      </button>
      {disabled && (
        <div className="cs-mono text-[0.7rem] mt-3 text-center" style={{ color: "var(--cs-amber)" }}>
          按钮已禁用：请先在左侧勾选至少一份「已持签」数字合约
        </div>
      )}
      {msg && (
        <div className="cs-mono text-[0.7rem] mt-3 text-center" style={{ color: "var(--cs-cyan)" }}>
          {msg}
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
