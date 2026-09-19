import { sm3 } from "sm-crypto";

/**
 * 稳定序列化：对象键递归排序，数组保序。
 *
 * 三处共用同一口径（改动即改哈希/签名）：
 *  1. 聚合结果 SM3（P1-6，连接器 ↔ 平台；
 *     connector: apps/connector/src/domain/canonical-json.ts）；
 *  2. 下发任务签名（outbound-longpoll-agent-auth D4）；
 *  3. 连接器请求体 SM3（连接器签名的上报接口覆盖请求体）。
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * 请求体的 SM3（64 hex 小写）。连接器把这个摘要放进请求签名的载荷里，
 * 使签名覆盖请求体，防止经过代理的篡改。
 *
 * 两端同一规则：无请求体 → `""`（连接器对 GET/无 body 的调用签名用 `""`）；
 * 否则 `sm3(stableStringify(body))`（解析后的对象，与连接器发出去的内容同构）。
 *
 * 注意：Express body-parser 对「无请求体」的 GET 会把 `req.body` 置为 `{}`（而非
 * undefined），若直接哈希会得到 `sm3("{}")`，与连接器的 `""` 不一致导致签名验证失败
 * （长轮询领取任务即无体 GET）。故这里把空对象/空数组也视作无请求体返回 `""`。
 * 连接器所有带体上报均为非空载荷，不会出现「签名了空 {}」的反向不一致。
 */
export function canonicalBodySm3(body: unknown): string {
  if (body === undefined || body === null) return "";
  if (typeof body === "object") {
    const empty = Array.isArray(body)
      ? body.length === 0
      : Object.keys(body as Record<string, unknown>).length === 0;
    if (empty) return "";
  }
  return sm3(stableStringify(body));
}
