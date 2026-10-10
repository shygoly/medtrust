import { Field } from "./orchestration-field";

export function ContractMultiSelect({
  label = "生效数字合约",
  contracts,
  selectedIds,
  onChange,
  multiple = true,
}: {
  label?: string;
  contracts: {
    id: string;
    purpose: string;
    providerId: string;
    dataProductId?: string;
    preReview?: { verdict?: string } | null;
  }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
}) {
  const toggle = (id: string) => {
    if (!multiple) {
      onChange([id]);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (!multiple) {
    return (
      <Field label={label}>
        <select
          className="cs-input"
          value={selectedIds[0] ?? ""}
          onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        >
          <option value="">选择合约…</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.purpose} · {String(c.providerId)} · {String(c.id).slice(0, 8)} · 预审 {c.preReview?.verdict ?? "无(旧合约)"}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2" style={{ borderColor: "var(--cs-line-soft)" }}>
        {contracts.length === 0 && (
          <p className="text-xs px-1" style={{ color: "var(--cs-faint)" }}>
            无生效合约
          </p>
        )}
        {contracts.map((c) => {
          const checked = selectedIds.includes(c.id);
          return (
            <label
              key={c.id}
              className="flex items-start gap-2 text-sm cursor-pointer rounded px-2 py-1.5 hover:bg-[var(--cs-panel-elevated)]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.id)}
                className="mt-1"
              />
              <span>
                <span className="block">{c.purpose}</span>
                <span className="cs-mono text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>
                  {c.providerId} · {c.dataProductId ?? "—"} · {c.id.slice(0, 8)} · 预审 {c.preReview?.verdict ?? "无(旧合约)"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-[0.68rem] mt-2" style={{ color: "var(--cs-faint)" }}>
        已选 {selectedIds.length} 份 · 多院任务请各选一份（示范甲 / 示范乙），目的须一致
      </p>
    </Field>
  );
}
