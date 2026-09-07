"use client";

import { Lock, Unlock } from "lucide-react";
import { FROZEN_FIELDS } from "@/lib/rws-protocol-schema";

/**
 * rws-study-protocol-spec §6.3 — field freeze marker.
 *
 * Renders a small 🔒 / 🔓 icon next to a form field label so the user can
 * see WHICH fields become immutable after first dispatch (D1/D3) BEFORE
 * submitting — the design doc calls this out as the friction-mitigation for
 * the freeze rule.
 *
 * Use `<FreezeMarker field="designType" />` next to a frozen field, or
 * `<FreezeMarker field="title" />` for a non-frozen field. The lookup is
 * against the FROZEN_FIELDS constant (canonical source).
 */
export function FreezeMarker({ field }: { field: string }) {
  const isFrozen = (FROZEN_FIELDS as readonly string[]).includes(field);
  const Icon = isFrozen ? Lock : Unlock;
  const color = isFrozen ? "var(--cs-amber)" : "var(--cs-faint)";
  const title = isFrozen
    ? "派发后冻结，修改需新建版本（rws-study-protocol-spec D3）"
    : "派发后仍可修改";
  return (
    <span
      className="inline-flex items-center ml-1 align-middle"
      style={{ color }}
      title={title}
    >
      <Icon size={11} />
    </span>
  );
}

/**
 * Convenience wrapper: renders a label string + FreezeMarker in one span.
 * Drop-in replacement for plain `<label>text</label>` on protocol form fields.
 */
export function FreezeLabel({
  field,
  children,
}: {
  field: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline">
      <span>{children}</span>
      <FreezeMarker field={field} />
    </span>
  );
}
