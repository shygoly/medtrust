#!/usr/bin/env node
/**
 * 连接器注册（D-MDOP-3 / 任务 4.4）：**只提交公钥**，平台不代生成、不回传私钥。
 *
 *   node apps/connector/scripts/register.mjs \
 *     --connector-id cn-demohospa --participant-id p-demohospa \
 *     [--api http://localhost:5021/api/v1] [--token <operator JWT>]
 *
 * 私钥从 CONNECTOR_SM2_PRIVATE_KEY 或 CONNECTOR_SM2_PRIVATE_KEY_FILE（默认
 * data/connector-sm2.key，权限必须 0600）读取；脚本本身只上传公钥。
 */
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const mdop = require('@medtrust/mdop');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const connectorId = readFlag('--connector-id', process.env.CONNECTOR_ID ?? '');
const participantId = readFlag('--participant-id', process.env.CONNECTOR_PARTICIPANT_ID ?? '');
const api = readFlag(
  '--api',
  process.env.CONTROL_PLANE_URL ?? 'http://localhost:5021/api/v1',
).replace(/\/$/, '');
const token = readFlag('--token', process.env.MEDTRUST_API_TOKEN ?? '');

if (!connectorId || !participantId) {
  console.error('缺少 --connector-id 或 --participant-id');
  process.exit(1);
}
if (!token) {
  console.error('缺少 --token（operator 角色的 JWT）：注册接口需要 operator 权限');
  process.exit(1);
}

function loadPrivateKey() {
  const inline = (process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '').trim();
  if (inline) return inline.toLowerCase();
  const file = resolve(process.env.CONNECTOR_SM2_PRIVATE_KEY_FILE ?? 'data/connector-sm2.key');
  const mode = statSync(file).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`私钥文件权限必须是 0600（当前 ${mode.toString(8)}）：chmod 600 ${file}`);
  }
  return readFileSync(file, 'utf8').trim().toLowerCase();
}

const privateKey = loadPrivateKey();
if (!/^[0-9a-f]{64}$/.test(privateKey)) throw new Error('连接器私钥形状非法（须 64 hex）');
const publicKey = mdop.publicKeyFromPrivateKey(privateKey);

const res = await fetch(`${api}/connectors/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  // 只上传公钥：平台不会、也无法拿到本院私钥。
  body: JSON.stringify({ connectorId, participantId, subjectPublicKey: publicKey }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`[失败] ${res.status} ${text}`);
  process.exit(1);
}

const body = JSON.parse(text);
const cert = body.certificate ?? {};
console.log('注册完成（只提交了公钥）：');
console.log(`  公钥        ${publicKey}`);
console.log(`  kid         ${mdop.publicKeyKid(publicKey)}`);
console.log(`  证书指纹    ${cert.fingerprint ?? '(未返回)'}`);
if ('privateKey' in body) {
  console.error('[严重] 平台响应里出现了私钥字段 —— 这违反「参与方密钥自持」，请立即排查。');
  process.exit(2);
}
console.log(`在连接器部署配置里设置 CONNECTOR_CERT_FINGERPRINT=${cert.fingerprint ?? ''}`);
