export { OrchestrationField as Field, OrchestrationPreviewRow as PreviewRow };

export function OrchestrationField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="cs-label block mb-2">{label}</label>
      {children}
    </div>
  );
}

export function OrchestrationPreviewRow({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="cs-label shrink-0 w-20 pt-0.5">{k}</dt>
      <dd className={`flex-1 ${mono ? "cs-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
