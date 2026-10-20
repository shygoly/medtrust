/**
 * 字段校验与 Card 结构校验（spec.md FR-2 验收标准）。
 */
import type { CardMessage, FormField } from './types';

const isNil = (value: unknown): boolean => value === undefined || value === null;

/** 把数字型/文本型输入统一成 number；非法返回 null。 */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 校验单个字段；通过返回 null，否则返回面向用户的中文错误。 */
export function validateField(field: FormField, value: unknown): string | null {
  const empty =
    isNil(value) || value === '' || (Array.isArray(value) && value.length === 0);

  if (field.required && empty) return `${field.label}为必填项`;
  if (empty) return null;

  switch (field.type) {
    case 'number': {
      const num = coerceNumber(value);
      if (num === null) return field.validation?.message ?? `${field.label}必须是数字`;
      const { min, max } = field.validation ?? {};
      if (min !== undefined && num < min) return `${field.label}不得小于 ${min}`;
      if (max !== undefined && num > max) return `${field.label}不得大于 ${max}`;
      return null;
    }
    case 'checkbox':
      return typeof value === 'boolean' ? null : `${field.label}必须是布尔值`;
    case 'select': {
      const options = field.options ?? [];
      const allowed = options.map((option) => option.value);
      return allowed.includes(String(value))
        ? null
        : field.validation?.message ?? `${field.label}取值不在候选中`;
    }
    case 'date': {
      const time = Date.parse(String(value));
      return Number.isFinite(time) ? null : `${field.label}不是合法日期`;
    }
    case 'text':
    default: {
      const pattern = field.validation?.pattern;
      if (pattern) {
        let re: RegExp;
        try {
          re = new RegExp(pattern);
        } catch {
          return `${field.label}的校验规则非法`;
        }
        if (!re.test(String(value)))
          return field.validation?.message ?? `${field.label}格式不正确`;
      }
      return null;
    }
  }
}

/** 校验整张表单；返回 `字段名 → 错误` 的映射（空对象即通过）。 */
export function validateFields(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateField(field, values[field.name]);
    if (error) errors[field.name] = error;
  }
  return errors;
}

const CARD_TYPES = new Set([
  'form',
  'status',
  'result',
  'confirm',
  'contract_approval',
  'contract_request',
  'contract_bundle',
  'contract_apply',
  'assistant_intent',
]);
const FIELD_TYPES = new Set(['text', 'number', 'select', 'date', 'checkbox']);

/** 结构校验：LLM 输出不可信，落库/下发前必须过这一关。 */
export function validateCardMessage(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) return ['card 必须是对象'];
  const card = value as Record<string, unknown>;

  if (typeof card.type !== 'string' || !CARD_TYPES.has(card.type))
    errors.push(`card.type 非法：${String(card.type)}`);
  if (typeof card.title !== 'string' || card.title.trim() === '')
    errors.push('card.title 必填');

  if (card.type === 'form' || Array.isArray(card.fields)) {
    const fields = card.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      errors.push('form card 必须有非空 fields');
    } else {
      fields.forEach((field, index) => {
        if (typeof field !== 'object' || field === null) {
          errors.push(`fields[${index}] 必须是对象`);
          return;
        }
        const f = field as Record<string, unknown>;
        if (typeof f.name !== 'string' || !f.name) errors.push(`fields[${index}].name 必填`);
        if (typeof f.label !== 'string' || !f.label) errors.push(`fields[${index}].label 必填`);
        if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type))
          errors.push(`fields[${index}].type 非法：${String(f.type)}`);
        // 允许 options: []（目录尚未加载的合法运行态）：卡片仍须下发，
        // 由卡片描述里的显式告警 + 前端降级（转文本输入）承担可用性。
        if (f.type === 'select' && !Array.isArray(f.options))
          errors.push(`fields[${index}] select 必须有 options 数组`);
      });
    }
  }

  // 合约卡的必填面：**只校验能机器判定的部分**，语义（谁签发、能不能过）由控制面说了算。
  if (card.type === 'contract_approval') {
    const contract = card.contract;
    if (typeof contract !== 'object' || contract === null) {
      errors.push('contract_approval 卡必须有 contract');
    } else {
      const c = contract as Record<string, unknown>;
      if (typeof c.purpose !== 'string' || c.purpose.trim() === '')
        errors.push('contract.purpose 必填');
      if (!Array.isArray(c.dataProducts) || c.dataProducts.length === 0)
        errors.push('contract.dataProducts 必须有非空数组');
    }
  }

  if (card.type === 'contract_apply') {
    const contract = card.contract;
    if (typeof contract !== 'object' || contract === null) {
      errors.push('contract_apply 卡必须有 contract');
    } else {
      const c = contract as Record<string, unknown>;
      if (typeof c.purpose !== 'string' || c.purpose.trim() === '')
        errors.push('contract.purpose 必填');
      if (typeof c.providerId !== 'string' || c.providerId.trim() === '')
        errors.push('contract.providerId 必填');
      if (!Array.isArray(c.dataProducts) || c.dataProducts.length === 0)
        errors.push('contract.dataProducts 必须有非空数组');
      if (!Array.isArray(card.fields) || card.fields.length === 0)
        errors.push('contract_apply 卡必须有非空 fields');
    }
  }

  if (card.type === 'contract_request') {
    if (typeof card.reason !== 'string' || card.reason.trim() === '')
      errors.push('contract_request 卡的 reason 必填');
    if (card.steps !== undefined && !Array.isArray(card.steps))
      errors.push('contract_request 卡的 steps 必须是数组');
  }

  if (card.type === 'contract_bundle') {
    if (!Array.isArray(card.requirements) || card.requirements.length === 0)
      errors.push('contract_bundle 卡的 requirements 必须是非空数组');
  }

  if (card.type === 'assistant_intent') {
    const data = card.data as Record<string, unknown> | undefined;
    if (!data || !Array.isArray(data.options) || data.options.length === 0)
      errors.push('assistant_intent 卡必须有非空 options');
  }

  // actions 可缺省（渲染器补默认动作），但给了就必须是数组
  // —— 只拦结构性错误，避免 LLM 写出 `"actions": {...}`。
  if (card.actions !== undefined && !Array.isArray(card.actions)) {
    errors.push('card.actions 必须是数组');
  }

  if (card.metadata !== undefined && (typeof card.metadata !== 'object' || card.metadata === null)) {
    errors.push('card.metadata 必须是对象');
  }
  return errors;
}

/** 类型守卫 + 结构校验，供服务端解析 LLM 输出使用。 */
export function isCardMessage(value: unknown): value is CardMessage {
  return validateCardMessage(value).length === 0;
}
