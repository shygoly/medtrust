import { useMemo, useState } from 'react';
import type { FormCardMessage } from '../types';
import { DEFAULT_FORM_ACTIONS } from '../types';
import { validateFields } from '../validation';
import { CheckboxField, DateField, NumberField, SelectField, TextField } from '../fields';
import type { FieldProps } from '../fields';

export interface FormCardProps {
  card: FormCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  className?: string;
}

function renderField(props: FieldProps) {
  switch (props.field.type) {
    case 'number':
      return <NumberField {...props} />;
    case 'select':
      return <SelectField {...props} />;
    case 'date':
      return <DateField {...props} />;
    case 'checkbox':
      return <CheckboxField {...props} />;
    case 'text':
    default:
      return <TextField {...props} />;
  }
}

export function FormCard({ card, onSubmit, disabled, className }: FormCardProps) {
  const initial = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const field of card.fields) {
      if (field.defaultValue !== undefined) values[field.name] = field.defaultValue;
    }
    return values;
  }, [card]);

  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const actions = card.actions?.length ? card.actions : DEFAULT_FORM_ACTIONS;

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = () => {
    const nextErrors = validateFields(card.fields, values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSubmit(values);
  };

  return (
    <section
      className={className ?? 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm'}
      data-card-type="form"
      data-card-title={card.title}
    >
      <header className="mb-3">
        <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
        {card.description ? (
          <p className="mt-1 text-sm text-slate-500">{card.description}</p>
        ) : null}
      </header>

      <div className="grid gap-3">
        {card.fields.map((field) => {
          const error = errors[field.name];
          return (
            <label key={field.name} className="grid gap-1" htmlFor={field.name}>
              <span className="text-sm font-medium text-slate-700">
                {field.label}
                {field.required ? <span className="text-red-500"> *</span> : null}
              </span>
              {renderField({
                field,
                value: values[field.name],
                error,
                disabled,
                onChange: (value) => handleChange(field.name, value),
              })}
              {field.help ? (
                <span className="text-xs text-slate-400">{field.help}</span>
              ) : null}
              {error ? (
                <span className="text-xs text-red-600" role="alert">
                  {error}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <footer className="mt-4 flex justify-end gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            data-testid={action.type === 'submit' ? 'submit-card' : undefined}
            data-action={action.type}
            disabled={disabled}
            className={
              action.variant === 'secondary'
                ? 'rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700'
                : 'rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50'
            }
            onClick={action.type === 'submit' ? handleSubmit : undefined}
          >
            {action.label}
          </button>
        ))}
      </footer>
    </section>
  );
}
