#!/usr/bin/env node
import { currentConnectorSpaceId } from "../space/space-context";
/**
 * 校验方（证明服务）的命令行入口（tdx-attestation-pilot 任务 3.2 / 4.5）。
 *
 *   pnpm --filter @medtrust/connector tee-verifier -- keygen   # 生成校验方 SM2 密钥（0600），打印公钥
 *   pnpm --filter @medtrust/connector tee-verifier -- serve    # 监听：/attest 证明探针、/keys 密钥托付、/release 密钥释放
 *
 * 部署位置：与可信空间节点**不同的域**（校验方不应由被校验者运营）。它只做两件事：
 * 验节点交来的证明并签背书；把背书推给平台登记（`POST /mdop/attestations/endorsements`）。
 * 试点期同进程兼做**密钥保管与释放**（design P4 的试点形态：密钥只在内存、只跑合成数据）；
 * 生产 KMS 的归属与形态归 D-TEE-1，不是本进程。
 */
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSm2KeyPair, type EndorsementPush } from '@medtrust/mdop';
import { publicKeyFromPrivateKeyHex } from '../domain/sm2-sign';
import { assertNodeKeyFileMode } from '../tee-node/identity';
import { tdxSidecarRunner } from '../tee-node/tdx/sidecar';
import {
  AttestationVerifierService,
  type KeyDepositRequest,
  type VerifierPolicy,
} from './verifier';

interface VerifierEnv {
  keyFile: string;
  sidecarPath: string;
  bind: string;
  port: number;
  platformUrl: string;
  policy: VerifierPolicy;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 公钥表（JSON：`participantId → SM2 公钥`）；未配置 = 空表（一律拒）。 */
function loadKeyTable(file: string | undefined): Map<string, string> {
  const path = (file ?? '').trim();
  if (!path) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>));
}

function required(name: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) throw new Error(`缺少必填配置 ${name}`);
  return v;
}

/** 逐键 `process.env.<KEY>` 直读（与 DEPLOY.md §2 登记表双向对拍，同 `tee-node/config.ts` 约定）。 */
function loadVerifierEnv(): VerifierEnv {
  const nodeKeysFile = required('TEE_VERIFIER_NODE_KEYS_FILE', process.env.TEE_VERIFIER_NODE_KEYS_FILE);
  const nodeKeys = new Map<string, string>(
    Object.entries(JSON.parse(readFileSync(nodeKeysFile, 'utf8')) as Record<string, string>),
  );
  return {
    keyFile: (process.env.TEE_VERIFIER_KEY_FILE ?? 'data/tee-verifier-sm2.key').trim(),
    sidecarPath: required('TEE_VERIFIER_TDX_SIDECAR', process.env.TEE_VERIFIER_TDX_SIDECAR),
    bind: (process.env.TEE_VERIFIER_BIND ?? '127.0.0.1').trim(),
    port: Number(process.env.TEE_VERIFIER_PORT ?? '5024'),
    platformUrl: (process.env.TEE_VERIFIER_PLATFORM_URL ?? '').trim().replace(/\/$/, ''),
    policy: {
      verifierId: required('TEE_VERIFIER_ID', process.env.TEE_VERIFIER_ID),
      spaceId: currentConnectorSpaceId(),
      nodeKeys,
      measurements: list(process.env.TEE_VERIFIER_MEASUREMENTS),
      minTcb: required('TEE_VERIFIER_MIN_TCB', process.env.TEE_VERIFIER_MIN_TCB),
      collateralMaxStalenessMinutes: Number(process.env.TEE_VERIFIER_COLLATERAL_MAX_STALENESS_MIN ?? '60'),
      endorsementTtlMinutes: Number(process.env.TEE_VERIFIER_ENDORSEMENT_TTL_MIN ?? '30'),
      clockSkewMs: 5 * 60_000,
      kmsRef: (process.env.TEE_VERIFIER_KMS_REF ?? 'kms://unconfigured').trim(),
      holderKeys: loadKeyTable(process.env.TEE_VERIFIER_HOLDER_KEYS_FILE),
    },
  };
}

function loadOrCreateKey(keyFile: string, create: boolean): { privateKey: string; publicKey: string } {
  if (!existsSync(keyFile)) {
    if (!create) throw new Error(`校验方密钥不存在：${keyFile}（先运行 tee-verifier -- keygen）`);
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, generateSm2KeyPair().privateKey, { mode: 0o600 });
  }
  assertNodeKeyFileMode(keyFile);
  const privateKey = readFileSync(keyFile, 'utf8').trim();
  return { privateKey, publicKey: publicKeyFromPrivateKeyHex(privateKey) };
}

/**
 * 把背书推给平台登记（`POST /mdop/attestations/endorsements`）。背书自带校验方签名，
 * 平台用部署配置的公钥验签——本进程**不持有任何平台账号**。
 * 未配置平台地址 → 不推（只把背书回给节点），如实返回原因。
 */
async function pushToPlatform(env: VerifierEnv, push: EndorsementPush): Promise<string> {
  if (!env.platformUrl) return 'platform-push-skipped: TEE_VERIFIER_PLATFORM_URL 未配置';
  const res = await fetch(`${env.platformUrl}/mdop/attestations/endorsements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(push),
  });
  const text = await res.text();
  return res.ok
    ? `platform-registered: ${text.slice(0, 400)}`
    : `platform-push-failed: HTTP ${res.status} ${text.slice(0, 200)}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024) throw new Error('请求体过大');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export async function serveCommand(): Promise<void> {
  const env = loadVerifierEnv();
  const key = loadOrCreateKey(env.keyFile, false);
  const service = new AttestationVerifierService({
    policy: env.policy,
    privateKey: key.privateKey,
    publicKey: key.publicKey,
    runSidecar: tdxSidecarRunner(env.sidecarPath, 60_000),
  });

  const server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || !['/attest', '/keys', '/release'].includes(req.url ?? ''))
      return reply(404, { error: 'not found' });
    void (async () => {
      try {
        if (req.url === '/keys') {
          const body = (await readJson(req)) as KeyDepositRequest;
          const out = service.depositKey(body);
          console.log(
            `[托付] ${body?.holder} key=${body?.key_id} job=${body?.job_id}：${out.accepted ? '已登记' : out.detail}`,
          );
          return reply(200, out);
        }
        if (req.url === '/release') {
          const out = await service.releaseKey({
            participantId: header(req, 'x-connector-participant'),
            timestamp: header(req, 'x-connector-timestamp'),
            signature: header(req, 'x-connector-signature'),
            body: await readJson(req),
          });
          console.log(
            `[释放] ${header(req, 'x-connector-participant')}：${out.released ? `key=${out.warrant.key_id} → ${out.warrant.ephemeral_key_digest.slice(0, 16)}…` : out.detail}`,
          );
          return reply(200, out);
        }
        const verdict = await service.handleProbe({
          participantId: header(req, 'x-connector-participant'),
          timestamp: header(req, 'x-connector-timestamp'),
          signature: header(req, 'x-connector-signature'),
          body: await readJson(req),
        });
        if (!verdict.accepted) {
          console.log(`[拒绝] ${header(req, 'x-connector-participant')}：${verdict.detail}`);
          return reply(200, verdict);
        }
        const detail = await pushToPlatform(env, verdict.endorsement).catch(
          (err: Error) => `platform-push-failed: ${err.message}`,
        );
        const e = verdict.endorsement.endorsement;
        console.log(`[背书] ${e.node} tdx tcb=${e.tcb} ${e.quoteDigest} 至 ${e.expiresAt}｜${detail}`);
        reply(200, { ...verdict, detail });
      } catch (err) {
        console.error(`[错误] ${(err as Error).message}`);
        reply(400, { accepted: false, detail: '请求无法处理' });
      }
    })();
  });
  server.listen(env.port, env.bind, () => {
    console.log(
      `校验方启动：${env.policy.verifierId}｜监听 ${env.bind}:${env.port}/attest｜` +
        `节点 ${env.policy.nodeKeys.size} 个｜度量白名单 ${env.policy.measurements.length} 条｜` +
        `TCB ≥ ${env.policy.minTcb}｜背书有效期 ${env.policy.endorsementTtlMinutes} 分钟｜` +
        `平台登记 ${env.platformUrl ? '已配置' : '未配置（不推）'}`,
    );
    console.log(`校验方公钥：${key.publicKey}`);
  });
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a && a !== '--');
  if (args.includes('keygen')) {
    const keyFile = (process.env.TEE_VERIFIER_KEY_FILE ?? 'data/tee-verifier-sm2.key').trim();
    const key = loadOrCreateKey(keyFile, true);
    console.log(`校验方密钥已就绪：${keyFile}（权限 0600）`);
    console.log(`公钥（写进节点的 TEE_NODE_KMS_PUBKEY 与平台的 MDOP_KMS_PUBKEY）：${key.publicKey}`);
    return;
  }
  if (args.includes('serve')) return serveCommand();
  console.error('用法：tee-verifier -- <keygen|serve>');
  process.exitCode = 2;
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`[tee-verifier] ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
