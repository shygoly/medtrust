'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SECRETFLOW_SPEC_YAML } from '@medtrust/demo-scenario';
import { useSecretFlowOrchestration } from '@/hooks/use-secretflow-orchestration';
import { SecretFlowMonitor } from '@/components/secretflow/secretflow-monitor';

const SAMPLE_YAML = SECRETFLOW_SPEC_YAML;

export default function SecretFlowPage() {
  const [yamlText, setYamlText] = useState(SAMPLE_YAML);
  const o = useSecretFlowOrchestration();

  return (
    <div className="px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">密算编排 · SecretFlow</h1>
          <p className="mt-2 text-sm text-gray-700">
            声明式 YAML → 异构节点适配 → 隐语脚本转译 → gRPC 下发本地数据代理 → 实时联邦训练日志流。
          </p>
        </div>
        <Link
          href="/dashboard/secretflow/assistant"
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          ✨ 用自然语言生成
        </Link>
      </div>

      {o.error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-md text-sm">{o.error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: spec editor */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">任务声明（SecretFlowTaskSpec / YAML）</label>
          <textarea
            value={yamlText} onChange={(e) => setYamlText(e.target.value)} spellCheck={false}
            className="w-full h-96 font-mono text-xs border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-3">
            <button onClick={() => o.preview(yamlText)} disabled={o.busy}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              预览编排（不下发）
            </button>
            <button onClick={() => o.submit(yamlText)} disabled={o.busy}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              提交并训练
            </button>
          </div>
        </div>

        {/* Right: live monitor */}
        <SecretFlowMonitor o={o} />
      </div>
    </div>
  );
}
