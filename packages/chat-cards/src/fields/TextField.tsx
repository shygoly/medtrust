import type { FieldProps } from './FieldProps';
import { asText, FIELD_INPUT_CLASS } from './FieldProps';

export function TextField({ field, value, error, disabled, onChange }: FieldProps) {
  return (
    <input
      id={field.name}
      name={field.name}
      type="text"
      className={FIELD_INPUT_CLASS}
      style={error ? { borderColor: '#dc2626' } : undefined}
      placeholder={field.placeholder}
      value={asText(value)}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
