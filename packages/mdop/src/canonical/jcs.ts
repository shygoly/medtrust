/**
 * RFC 8785 JSON Canonicalization Scheme（JCS）。
 *
 * MDOP 中所有需要哈希或签名的对象 MUST 先按本模块规范化，再算 SM3
 * （规格「规范化哈希」）。规范化的三点约定：
 *  1. 对象成员按 UTF-16 码元序排序；
 *  2. 字符串按 JSON 最小转义（`"`、`\`、控制字符），控制字符用 `\u00xx` 小写十六进制；
 *  3. 数字用 ECMAScript `Number::toString`（最短往返表示），`-0` 归一为 `0`，
 *     `NaN` / `±Infinity` 一律拒绝。
 *
 * 拒绝而不是静默修正：不可表示的值出现在协议对象里就是非法对象。
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(`JCS: ${message}`);
    this.name = "CanonicalizationError";
  }
}

const ESCAPE_SHORT: Record<number, string> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
};

function serializeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += "\\\\";
    } else if (code < 0x20) {
      out += ESCAPE_SHORT[code] ?? `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new CanonicalizationError("字符串含未配对的 UTF-16 高代理项");
      out += value[i] + value[i + 1];
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("字符串含未配对的 UTF-16 低代理项");
    } else {
      out += value[i];
    }
  }
  return out + '"';
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new CanonicalizationError("数字非有限值（NaN/Infinity）");
  // ECMAScript Number::toString 已是「最短往返」表示；String(-0) === "0"，
  // 指数形式为 `1e+30` / `1e-7`，与 RFC 8785 §3.2.2.3 的输出一致。
  return String(value);
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return serializeString(value);
    case "bigint":
      throw new CanonicalizationError("不允许 bigint（协议对象用 string 承载大整数）");
    case "undefined":
      throw new CanonicalizationError("不允许 undefined（缺省字段必须显式给 null 或省略）");
    case "function":
    case "symbol":
      throw new CanonicalizationError(`不允许的类型：${typeof value}`);
    case "object": {
      const obj = value as object;
      if (seen.has(obj)) throw new CanonicalizationError("对象存在循环引用");
      seen.add(obj);
      let out: string;
      if (Array.isArray(obj)) {
        out = `[${obj.map((item) => serialize(item, seen)).join(",")}]`;
      } else {
        const entries = Object.entries(obj as Record<string, unknown>);
        if (entries.some(([, v]) => v === undefined))
          throw new CanonicalizationError("对象成员不得为 undefined");
        entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        out = `{${entries
          .map(([k, v]) => `${serializeString(k)}:${serialize(v, seen)}`)
          .join(",")}}`;
      }
      seen.delete(obj);
      return out;
    }
    default:
      throw new CanonicalizationError(`不允许的类型：${typeof value}`);
  }
}

/** RFC 8785 规范化：返回无空白、成员有序的 JSON 文本。 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set<object>());
}

/** 规范化后的 UTF-8 字节（签名/摘要的输入口径）。 */
export function canonicalBytes(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalize(value), "utf8"));
}

/**
 * 去掉签名字段后的对象副本——协议里「签名内容 = 去掉 sig 的信封」的规范化入口。
 * 只在顶层删一个键；嵌套结构不动。
 */
export function withoutSignature<T extends Record<string, unknown>>(
  value: T,
  key = "sig",
): Omit<T, typeof key> {
  const { [key]: _omitted, ...rest } = value as Record<string, unknown>;
  return rest as Omit<T, typeof key>;
}
