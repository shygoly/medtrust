"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/console/ui";
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
        <Panel className="p-5 mt-5">
          <h3 className="cs-label mb-2">注册型外部对照</h3>
          <p className="text-sm mb-3" style={{ color: "var(--cs-dim)" }}>
            先定义目标试验、ATT estimand、SAP、数据源与逐成员 ContractBundle，再进入 IPTW-ATT 可信节点执行。
          </p>
          <Link
            href="/space/assistant?prompt=创建一项单臂外部对照注册研究并生成模拟报告"
            className="cs-btn inline-flex"
          >
            在 AI 助手中创建
          </Link>
        </Panel>
      </div>
    </div>
  );
}
