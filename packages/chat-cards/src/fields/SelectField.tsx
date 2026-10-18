import type { FieldProps } from './FieldProps';
import { asText, FIELD_INPUT_CLASS } from './FieldProps';

export function SelectField({ field, value, error, disabled, onChange }: FieldProps) {
  return (
    <select
      id={field.name}
      name={field.name}
      className={FIELD_INPUT_CLASS}
      style={error ? { borderColor: '#dc2626' } : undefined}
      value={asText(value)}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{field.placeholder ?? '请选择'}</option>
      {(field.options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
