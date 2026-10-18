import type { StatusCardMessage } from '../types';

const TONE_CLASS: Record<string, string> = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  pending: 'border-sky-200 bg-sky-50 text-sky-700',
};

export interface StatusCardProps {
  card: StatusCardMessage;
  className?: string;
}

export function StatusCard({ card, className }: StatusCardProps) {
  const tone = card.tone ?? 'info';
  return (
    <section
      className={className ?? `rounded-lg border p-4 text-sm ${TONE_CLASS[tone] ?? TONE_CLASS.info}`}
      data-card-type="status"
      data-card-title={card.title}
      data-tone={tone}
      // 有 jobId 才输出：让外部（测试 / 跳转 / 埋点）能稳定引用作业号，
      // 不必从渲染出来的散文里抠正则。
      data-job-id={typeof card.data?.jobId === 'string' ? card.data.jobId : undefined}
    >
      <h3 className="text-base font-semibold">{card.title}</h3>
      {card.description ? <p className="mt-1">{card.description}</p> : null}
      {card.data ? (
        <dl className="mt-2 grid gap-1">
          {Object.entries(card.data).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="text-slate-500">{key}</dt>
              <dd className="font-medium">{String(value ?? '')}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
