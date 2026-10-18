import type { ToolContext, ToolResult } from './types/index';

/**
 * Tool parameter schema (JSON Schema subset)
 */
export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

/**
 * Tool parameters definition
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ParameterSchema>;
  required?: string[];
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Validate tool call parameters against schema
 */
export function validateToolParameters(
  params: unknown,
  schema: ToolParameters
): string[] {
  const errors: string[] = [];

  if (typeof params !== 'object' || params === null) {
    errors.push('Parameters must be an object');
    return errors;
  }

  const paramsObj = params as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in paramsObj)) {
        errors.push(`Missing required parameter: ${field}`);
      }
    }
  }

  // Validate each property
  for (const [key, value] of Object.entries(paramsObj)) {
    const propSchema = schema.properties[key];
    if (!propSchema) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }

    const propErrors = validateValue(value, propSchema, key);
    errors.push(...propErrors);
  }

  return errors;
}

function validateValue(
  value: unknown,
  schema: ParameterSchema,
  path: string
): string[] {
  const errors: string[] = [];

  // Type check
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type !== actualType) {
    errors.push(`${path}: expected ${schema.type}, got ${actualType}`);
    return errors;
  }

  // Enum check
  if (schema.enum && !schema.enum.includes(value as string)) {
    errors.push(`${path}: must be one of [${schema.enum.join(', ')}]`);
  }

  // Number range check
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}`);
    }
  }

  // Array items check
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      const itemErrors = validateValue(item, schema.items!, `${path}[${index}]`);
      errors.push(...itemErrors);
    });
  }

  // Object properties check
  if (schema.type === 'object' && typeof value === 'object' && value !== null && schema.properties) {
    const objValue = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(objValue)) {
      const propSchema = schema.properties[key];
      if (propSchema) {
        const propErrors = validateValue(val, propSchema, `${path}.${key}`);
        errors.push(...propErrors);
      }
    }
  }

  return errors;
}
