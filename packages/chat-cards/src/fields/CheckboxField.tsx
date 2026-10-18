import type { FieldProps } from './FieldProps';
import { asBool } from './FieldProps';

export function CheckboxField({ field, value, error, disabled, onChange }: FieldProps) {
  return (
    <input
      id={field.name}
      name={field.name}
      type="checkbox"
      className="h-4 w-4 rounded border-slate-300"
      checked={asBool(value)}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
