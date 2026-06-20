'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ASSISTANT_PLACEHOLDER } from '@medtrust/demo-scenario';
import { api, type SecretFlowDraftResponse } from '@/api/client';
import { useSecretFlowOrchestration } from '@/hooks/use-secretflow-orchestration';
import { SecretFlowMonitor } from '@/components/secretflow/secretflow-monitor';

const STEPS = ['描述意图', '审阅草稿', '确认并训练'];

const PLACEHOLDER = ASSISTANT_PLACEHOLDER;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              i < step ? 'bg-green-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i < step ? '✓' : i + 1}
          </span>
          <span className={i === step ? 'font-medium text-gray-900' : 'text-gray-500'}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 text-gray-300">→</span>}
        </li>
      ))}
    </ol>
  );
}

function SpecReview({ draft }: { draft: SecretFlowDraftResponse }) {
  const { spec, rationale } = draft;
  const Card = ({ title, why, children }: { title: string; why?: string; children: React.ReactNode }) => (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="text-sm font-medium text-gray-800">{title}</div>
      <div className="mt-1 text-xs text-gray-700">{children}</div>
      {why && <div className="mt-2 text-xs text-blue-700">为什么这样配：{why}</div>}
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Card title="参与方" why={rationale.parties}>
        {spec.parties.map((p) => (
          <div key={p.participantId} className="font-mono">
            {p.participantId} · <span className="text-gray-500">{p.role}</span>
          </div>
        ))}
      </Card>
      <Card title="数据模态" why={rationale.modalities}>
        {spec.modalities.map((m, i) => (
          <span key={i} className="mr-2 inline-block rounded bg-gray-100 px-1.5 py-0.5">{m.type}</span>
        ))}
      </Card>
      <Card title="模型骨干" why={rationale.llmBackbone}>
        {spec.llmBackbone.modelType} / {spec.llmBackbone.modelNameOrPath}
      </Card>
      <Card title="PEFT 策略" why={rationale.peftStrategy}>
        {spec.peftStrategy.type} · r={spec.peftStrategy.r} α={spec.peftStrategy.alpha} · [{spec.peftStrategy.targetModules.join(', ')}]
      </Card>
      <Card title="隐私配置" why={rationale.privacy}>
        TEE={String(spec.privacy.teeRequired)} · HEU={String(spec.privacy.heuEnabled)}
        {spec.privacy.dpSgd ? ' · 已启用 DP-SGD' : ''}
      </Card>
      <Card title="输出策略" why={rationale.outputPolicy}>
        {spec.outputPolicy.allowedArtifacts.join(', ')}
      </Card>
    </div>
  );
}

export default function SecretFlowAssistantPage() {
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [draft, setDraft] = useState<SecretFlowDraftResponse | null>(null);
  const [yamlText, setYamlText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const o = useSecretFlowOrchestration();

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const d = await api.draftSecretFlowSpec(description, purpose || undefined);
      setDraft(d); setYamlText(d.yaml); setStep(1);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">任务设计助手 · SecretFlow</h1>
          <p className="mt-2 text-sm text-gray-700">
            用自然语言描述研究意图，AI 生成合法的编排声明草稿并逐项解释；你审阅、微调后提交。
            助手只生成草稿，提交仍经 PEP 准入与输出门强制校验。
          </p>
        </div>
        <Link href="/dashboard/secretflow" className="shrink-0 px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
          手写 YAML
        </Link>
      </div>

      <Stepper step={step} />

      {error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-md text-sm">{error}</div>}

      {/* Step 1: describe intent */}
      {step === 0 && (
        <div className="space-y-3 max-w-2xl">
          <label className="block text-sm font-medium text-gray-700">研究意图（自然语言）</label>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={PLACEHOLDER} rows={6}
            className="w-full text-sm border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500"
          />
          <label className="block text-sm font-medium text-gray-700">目的限定（可选）</label>
          <input
            value={purpose} onChange={(e) => setPurpose(e.target.value)}
            placeholder="如：复发预测模型训练"
            className="w-full text-sm border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={generate} disabled={loading || description.trim().length === 0}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '生成中…' : '生成草稿'}
          </button>
        </div>
      )}

      {/* Step 2: review draft */}
      {step === 1 && draft && (
        <div className="space-y-5">
          {(draft.warnings.length > 0 || draft.assumptions.length > 0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
              {draft.assumptions.map((a, i) => <div key={`a${i}`}>· 推断/占位：{a}</div>)}
              {draft.warnings.map((w, i) => <div key={`w${i}`}>⚠ {w}</div>)}
            </div>
          )}

          <SpecReview draft={draft} />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">声明 YAML（可微调）</label>
            <textarea
              value={yamlText} onChange={(e) => setYamlText(e.target.value)} spellCheck={false}
              className="w-full h-72 font-mono text-xs border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(0)}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
              重新描述
            </button>
            <button onClick={() => setStep(2)}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700">
              下一步：确认并训练
            </button>
          </div>
        </div>
      )}

      {/* Step 3: confirm + train (reuses the existing orchestration flow) */}
      {step === 2 && (
        <div className="space-y-5">
          {o.error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-md text-sm">{o.error}</div>}
          <div className="flex gap-3">
            <button onClick={() => setStep(1)}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
              返回审阅
            </button>
            <button onClick={() => o.preview(yamlText)} disabled={o.busy}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              预览编排（不下发）
            </button>
            <button onClick={() => o.submit(yamlText)} disabled={o.busy}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              提交并训练
            </button>
          </div>
          <SecretFlowMonitor o={o} />
        </div>
      )}
    </div>
  );
}
