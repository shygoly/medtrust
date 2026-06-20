'use client';

import { ArrowRight } from 'lucide-react';

const STEPS = [
  { id: 'declare', label: '声明', detail: 'CKD 多模态 YAML' },
  { id: 'hetero', label: '异构适配', detail: '节点能力画像' },
  { id: 'transpile', label: '转译', detail: 'Meditron-7B + LoRA' },
  { id: 'dispatch', label: 'gRPC 下发', detail: 'Agent 调度' },
  { id: 'fedavg', label: 'FedAvg', detail: 'LoRA 聚合' },
  { id: 'ws', label: 'WS 流', detail: '实时 loss' },
  { id: 'fsm', label: 'FSM', detail: '补偿与回滚' },
] as const;

export function OrchestrationPipeline({ className = '' }: { className?: string }) {
  return (
    <div className={className} role="img" aria-labelledby="pipeline-title pipeline-desc">
      <span id="pipeline-title" className="sr-only">SecretFlow 密算编排流水线</span>
      <span id="pipeline-desc" className="sr-only">
        从 YAML 声明到异构适配、转译、gRPC 下发、FedAvg 聚合、WebSocket 实时流与 FSM 状态机的完整编排链路
      </span>

      <div className="flex flex-wrap items-center justify-center gap-2 md:gap-1">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1 md:gap-2">
            <div className="group relative">
              <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition hover:border-blue-300 hover:shadow-md min-w-[72px] md:min-w-[88px]">
                <span className="text-[10px] font-medium text-blue-600 mb-0.5">0{i + 1}</span>
                <span className="text-sm font-semibold text-slate-900">{step.label}</span>
                <span className="text-[10px] text-slate-500 mt-0.5 text-center leading-tight">{step.detail}</span>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <ArrowRight className="hidden sm:block w-4 h-4 text-slate-300 shrink-0" aria-hidden />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
