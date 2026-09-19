/**
 * 稳定序列化：对象键递归排序，数组保序。
 *
 * 与平台侧 apps/api/src/common/canonical-json.ts 同口径，用于：
 *  1. 聚合结果 SM3（回传哈希与平台 aggregateSm3 必须一致）；
 *  2. 下发任务签名的规范化内容（outbound-longpoll-agent-auth D4）；
 *  3. 请求体 SM3（连接器签名覆盖请求体）。
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
