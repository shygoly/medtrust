import type { FieldProps } from './FieldProps';
import { asText, FIELD_INPUT_CLASS } from './FieldProps';

export function NumberField({ field, value, error, disabled, onChange }: FieldProps) {
  const { min, max } = field.validation ?? {};
  return (
    <input
      id={field.name}
      name={field.name}
      type="number"
      className={FIELD_INPUT_CLASS}
      style={error ? { borderColor: '#dc2626' } : undefined}
      placeholder={field.placeholder}
      value={asText(value)}
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      onChange={(event) =>
        onChange(event.target.value === '' ? '' : Number(event.target.value))
      }
    />
  );
}
