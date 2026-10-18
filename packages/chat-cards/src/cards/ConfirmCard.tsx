import type { ConfirmCardMessage } from '../types';
import { DEFAULT_CONFIRM_ACTIONS } from '../types';

export interface ConfirmCardProps {
  card: ConfirmCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
}

export function ConfirmCard({ card, onSubmit, onCancel, disabled, className }: ConfirmCardProps) {
  const actions = card.actions?.length ? card.actions : DEFAULT_CONFIRM_ACTIONS;
  return (
    <section
      className={className ?? 'rounded-lg border border-slate-200 bg-white p-4'}
      data-card-type="confirm"
      data-card-title={card.title}
    >
      <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
      {card.description ? (
        <p className="mt-1 text-sm text-slate-500">{card.description}</p>
      ) : null}
      {card.data ? (
        <dl className="mt-3 grid gap-1 text-sm">
          {Object.entries(card.data).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="text-slate-500">{key}</dt>
              <dd className="font-medium text-slate-900">{String(value ?? '')}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <footer className="mt-4 flex justify-end gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            data-action={action.type}
            data-testid={action.type === 'submit' ? 'submit-card' : undefined}
            disabled={disabled}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700"
            onClick={() => {
              if (action.type === 'submit') onSubmit(card.data ?? {});
              else onCancel?.();
            }}
          >
            {action.label}
          </button>
        ))}
      </footer>
    </section>
  );
}
