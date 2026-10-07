"use client";

import Link from "next/link";
import { useState } from "react";
import { SECRETFLOW_SPEC_YAML } from "@medtrust/demo-scenario";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSecretFlowOrchestration } from "@/hooks/use-secretflow-orchestration";
import { PageHeader } from "@/components/console/ui";

// 声明式密算编排台：任务以 YAML 声明 → 编排器按节点能力画像适配 → 转译成隐语
// (SecretFlow) 执行脚本 → gRPC 下发各院连接器。原始数据不出域，此页只处理任务
// 声明与转译产物，不接触任何患者级数据。
export default function AtlasYamlPage() {
  const [yamlText, setYamlText] = useState(SECRETFLOW_SPEC_YAML);
  const o = useSecretFlowOrchestration();

  return (
    <div>
      <PageHeader
        kicker="YAML · 把任务声明成 YAML"
        desc="声明式 YAML → 异构节点能力画像适配 → 隐语脚本转译 → gRPC 下发本院连接器 → 实时训练日志流。原始数据留在各院,跨域只流动聚合结果与模型增量。"
      />
      <div className="p-8">
      {o.error && (
        <div
          className="mb-6 rounded px-4 py-3 text-sm border"
          style={{ color: "var(--cs-red)", borderColor: "var(--cs-red)" }}
        >
          {o.error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* 左：任务声明 */}
        <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
          <CardContent className="p-5">
            <div className="cs-label mb-3">任务声明 · SecretFlowTaskSpec / YAML</div>
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              spellCheck={false}
              rows={30}
              className="w-full font-mono text-[11px] leading-[1.6] rounded-md p-3 outline-none resize-y"
              style={{
                background: "var(--cs-bg)",
                color: "var(--cs-text)",
                border: "1px solid var(--cs-line)",
              }}
            />
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                disabled={o.busy}
                onClick={() => o.preview(yamlText)}
              >
                预览编排（不下发）
              </Button>
              <Button disabled={o.busy} onClick={() => o.submit(yamlText)}>
                提交并训练
              </Button>
            </div>
            {o.taskId && (
              <Link href={`/space/federated/${encodeURIComponent(o.taskId)}`} className="cs-key inline-block mt-4">
                查看该任务的训练与合并结果 →
              </Link>
            )}
          </CardContent>
        </Card>

        {/* 右：转译产物 */}
        <div className="space-y-6">
          {o.nodePlan.length > 0 && (
            <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
              <CardContent className="p-5">
                <div className="cs-label mb-3">
                  异构节点适配 · {o.nodePlan.length} 个参与方
                </div>
                <div className="space-y-2">
                  {o.nodePlan.map((n) => (
                    <div
                      key={n.participantId}
                      className="flex items-baseline justify-between gap-3 text-xs font-mono"
                    >
                      <span style={{ color: "var(--cs-text)" }}>{n.participantId}</span>
                      <span className="cs-key">{n.tier}</span>
                      <span style={{ color: "var(--cs-faint)" }}>{n.device}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="cs-reveal" style={{ background: "var(--cs-bg-2)" }}>
            <CardContent className="p-5">
              <div className="cs-label mb-3">转译产物 · 隐语执行脚本</div>
              <pre
                className="font-mono text-[11px] leading-[1.6] rounded-md p-3 overflow-auto max-h-[560px]"
                style={{
                  background: "var(--cs-bg)",
                  color: "var(--cs-dim)",
                  border: "1px solid var(--cs-line)",
                }}
              >
                {o.transpiled || "点击「预览编排」由编排器转译出 SecretFlow 执行脚本。"}
              </pre>
              {o.fsmState && (
                <div className="mt-3 text-xs" style={{ color: "var(--cs-faint)" }}>
                  FSM 状态 · <span className="cs-key">{o.fsmState}</span>
                  {o.taskId ? ` · task ${o.taskId}` : ""}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}
