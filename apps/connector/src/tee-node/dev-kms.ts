import { readFileSync } from 'node:fs';
import type { TrustedRoot } from '@medtrust/mdop';
import { assertNodeKeyFileMode } from './identity';

/**
 * 本机演练 KMS 的**显式装配**（仅供合成数据与组件联调）。
 *
 * 之前 `serve` 在 `TEE_NODE_KMS_MODE=local-dev` 时会因为 CLI 没有注入 `devKms`
 * 而在装配期失败；这个模块把部署侧的演练密钥变成一条显式配置，而不是静默拿节点身份密钥
 * 或平台密钥顶替。
 *
 * 安全边界：
 *  - 只读 0600 私钥文件；
 *  - 密钥表缺省为空；
 *  - 信任根缺省为空（本机没有厂商证明根）。即便有人误配成 `hardware`，本地 KMS 也不会
 *    因为“没根”而放行；能力通告仍由真实证明报告决定。
 */

export interface DevKmsOptions {
  privateKey: string;
  keys: Map<string, Uint8Array>;
  roots: TrustedRoot[];
}

const PRIVATE_KEY = /^[0-9a-f]{64}$/i;
const DATA_KEY = /^[0-9a-f]{64}$/i;

function readPrivateKey(file: string): string {
  assertNodeKeyFileMode(file);
  const privateKey = readFileSync(file, 'utf8').trim().toLowerCase();
  if (!PRIVATE_KEY.test(privateKey))
    throw new Error(`本机演练 KMS 私钥必须是 64 位十六进制标量：${file}`);
  return privateKey;
}

/** 可选演练密钥表：`{ "<key_id>": "<32-byte hex>" }`；任何一条不合法即整份拒绝。 */
function loadKeys(file: string | undefined): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  if (!file) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`本机演练 KMS 密钥表读取失败：${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('本机演练 KMS 密钥表必须是 { "<key_id>": "<hex>" }');
  for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!keyId || typeof value !== 'string' || !DATA_KEY.test(value))
      throw new Error(`本机演练 KMS 密钥 ${keyId || '(空)'} 必须是 32 字节十六进制`);
    keys.set(keyId, Buffer.from(value, 'hex'));
  }
  return keys;
}

/**
 * 从部署配置读取演练 KMS。未配置 `TEE_NODE_DEV_KMS_KEY_FILE` 时返回 `undefined`：
 * 调用方仍会在 `local-dev` 模式下得到原来的 fail-closed 错误，不会默默生成一把临时密钥。
 */
export function devKmsFromEnv(): DevKmsOptions | undefined {
  const keyFile = (process.env.TEE_NODE_DEV_KMS_KEY_FILE ?? '').trim();
  if (!keyFile) return undefined;
  return {
    privateKey: readPrivateKey(keyFile),
    keys: loadKeys((process.env.TEE_NODE_DEV_KMS_KEYS_FILE ?? '').trim() || undefined),
    // 本机演练没有厂商证明根。真实硬件必须注入 hardwareAttestation + remote KMS。
    roots: [],
  };
}
