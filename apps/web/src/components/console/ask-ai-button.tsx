import Link from "next/link";

export interface AskAIButtonProps {
  intent: "study-design" | "access-contract" | "result-interpretation" | "platform-ops" | "compliance-evidence" | "hospital-mapping";
  objectType?: string;
  objectId?: string;
  status?: string;
  label?: string;
}

export function AskAIButton({
  intent,
  objectType,
  objectId,
  status,
  label = "询问 AI",
}: AskAIButtonProps) {
  const query = new URLSearchParams({ intent });
  if (objectType) query.set("objectType", objectType);
  if (objectId) query.set("objectId", objectId);
  if (status) query.set("status", status);
  return (
    <Link className="cs-btn-ghost text-xs" href={`/space/assistant?${query.toString()}`}>
      {label}
    </Link>
  );
}
