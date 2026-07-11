"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/console/ui";
import { WorkloadKindPicker } from "@/components/console/orchestration";

export default function NewOrchestrationHubPage() {
  return (
    <div>
      <PageHeader
        kicker="ORCHESTRATION · 出站编排"
        title="发起联邦任务"
        desc="选择与 RWS 相同的合约驱动编排模式：校验数字合约 → 写入连接器队列 → 各方出站拉取执行。"
      />
      <div className="p-8">
        <Link
          href="/space/tasks"
          className="inline-flex items-center gap-1.5 text-sm mb-6"
          style={{ color: "var(--cs-dim)" }}
        >
          <ArrowLeft size={14} /> 返回任务列表
        </Link>
        <WorkloadKindPicker />
      </div>
    </div>
  );
}
