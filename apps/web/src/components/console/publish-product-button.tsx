"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { RoleGate } from "@/components/console/role-gate";

/** Provider-only entry to the full catalog publish form. */
export function PublishProductButton({
  defaultType = "data",
}: { defaultType?: "data" | "service" } = {}) {
  const href =
    defaultType === "service"
      ? "/space/catalog/new?type=service"
      : "/space/catalog/new";
  return (
    <RoleGate roles={["provider"]}>
      <Link href={href} className="cs-btn">
        <Plus size={15} /> 发布数据产品
      </Link>
    </RoleGate>
  );
}
