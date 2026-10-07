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
        desc="选 L0 算法核验、RWS 阶梯（L1–L3）或 L4 联邦预测：校验数字合约 → 写入连接器队列 → 各方出站拉取执行。"
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
