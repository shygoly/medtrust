import type { AssistantIntentCardMessage } from '../types';

export interface AssistantIntentCardProps {
  card: AssistantIntentCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  className?: string;
}

export function AssistantIntentCard({
  card,
  onSubmit,
  disabled,
  className,
}: AssistantIntentCardProps) {
  return (
    <section
      className={className ?? 'rounded-lg border border-slate-300 bg-white p-4'}
      data-card-type="assistant_intent"
      data-card-title={card.title}
    >
      <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
      {card.description ? <p className="mt-1 text-sm text-slate-500">{card.description}</p> : null}
      <div className="mt-3 grid gap-2">
        {card.data.options.map((option) => (
          <button
            key={option.intent}
            type="button"
            className="rounded-md border border-slate-200 px-3 py-3 text-left hover:border-slate-400 disabled:opacity-50"
            disabled={disabled}
            data-intent={option.intent}
            onClick={() => onSubmit({ assistantIntent: option.intent })}
          >
            <span className="block text-sm font-medium text-slate-900">{option.title}</span>
            <span className="mt-1 block text-xs text-slate-500">{option.summary}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
