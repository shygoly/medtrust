// 递归剔除未填写的可选字段：undefined、空字符串、空数组、剔除后为空的对象。
// 0 与 false 是有效值，保留。后端对可选字段的约定是"要么不传、要么非空"。

export function compactPayload<T>(value: T): T {
  return (compact(value) ?? {}) as T;
}

function compact(value: unknown): unknown {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, compact(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}
