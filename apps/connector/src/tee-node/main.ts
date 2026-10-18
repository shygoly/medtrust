#!/usr/bin/env node
/**
 * 可信空间节点组件的命令行入口（任务 3.1–3.3）。
 *
 *   pnpm --filter @medtrust/connector tee-node -- keygen      # 本地生成身份密钥（0600），只提交公钥
 *   pnpm --filter @medtrust/connector tee-node -- advertise   # 打印能力通告（未接真实证明时 tee 恒为 null）
 *   pnpm --filter @medtrust/connector tee-node -- export-receipts <jobId>
 *                                                             # 从**节点自己的一手链**导出离线核验文件
 *   pnpm --filter @medtrust/connector tee-node -- register --token <operator JWT>
 *                                                             # 注册（只提交公钥）并打印证书指纹
 *   pnpm --filter @medtrust/connector tee-node -- heartbeat    # 上报一次能力通告（软件提供者恒 tee:null）
 *   pnpm --filter @medtrust/connector tee-node -- probe        # 真跑一次证明并交校验方背书（作业之前的登记）
 *   pnpm --filter @medtrust/connector tee-node -- serve        # 长驻运行（心跳 + 探针 + 长轮询 + 消息处置）
 *
 * 会话执行本身不在这里：它由 `runNodeSession` 装配（`session.ts`）——
 * 长驻循环见 `runtime.ts` + `assembly.ts`（任务 3.18）：`serve` 把身份、配置闸门、两处提供者接缝、
 * 清单/吊销、执行面、消息路由器与轮询接成一个进程；缺硬件时用替身可跑，硬件接上后只换两个实现。
 */
import { loadTeeNodeConfig } from './config';
import { loadNodeIdentity } from './identity';
import { createAttestationProvider, nodeCapabilityAdvertisement } from './providers';
import { exportReceiptsForJob, createNodeStateStore, nodeDataDir } from './state';
import { registerNode, sendNodeHeartbeat } from './registration';
import { nodePollerEnv } from './poller';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { tdxRegistryFromEnv, teeNodeWiringFromEnv } from './tdx/sidecar';
import { runAttestationProbe, type AttestationProbeOutcome } from './attestation-probe';

export function keygenCommand(): {
  urn: string;
  publicKey: string;
  kid: string;
  keyFile: string;
} {
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
    create: true,
  });
  return { urn: identity.urn, publicKey: identity.publicKey, kid: identity.kid, keyFile: identity.keyFile };
}

export async function advertiseCommand(): Promise<unknown> {
  const config = loadTeeNodeConfig();
  const provider = createAttestationProvider(config, tdxRegistryFromEnv());
  // 能力通告**由真跑一次证明得出**：软件提供者恒 `tee: null`，因此编译器不会把 C2 阶段放过来
  return nodeCapabilityAdvertisement({
    provider,
    runtime: ['native', 'wasm'],
    systemOps: [],
    whitelistDigests: [],
  });
}

/**
 * 从盘上的**一手链**导出离线核验文件（任务 3.16 / 8.5）。
 * 节点重启后内存是空的，但链在 `TEE_NODE_DATA_DIR` 里——这正是落盘要解决的问题。
 */
export function exportReceiptsCommand(jobId: string): { file: string; count: number } {
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
  });
  const receipts = new NodeReceiptChain({ node: identity.urn, privateKey: identity.privateKey });
  const artifacts = new NodeArtifactStore({ node: identity.urn, privateKey: identity.privateKey });
  const store = createNodeStateStore({ receipts, artifacts, dir: nodeDataDir() });
  return exportReceiptsForJob({ jobId, receipts, store, dir: nodeDataDir() });
}

/** 注册：只提交公钥；返回平台给的证书指纹（把它写进 TEE_NODE_CERT_FINGERPRINT）。 */
export async function registerCommand(operatorToken: string): Promise<{
  urn: string;
  publicKey: string;
  fingerprint: string;
  warnedAboutPrivateKey: boolean;
}> {
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
  });
  const out = await registerNode({
    baseUrl: config.controlPlaneUrl,
    participantId: config.participantId,
    publicKey: identity.publicKey,
    operatorToken,
  });
  return { urn: identity.urn, publicKey: identity.publicKey, ...out };
}

/** 心跳：带**由真跑一次证明得出**的能力通告（接入真实证明前 `tee` 恒为 null）。 */
export async function heartbeatCommand(): Promise<Record<string, unknown>> {
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
  });
  const advertisement = (await nodeCapabilityAdvertisement({
    provider: createAttestationProvider(config, tdxRegistryFromEnv()),
    runtime: ['native', 'wasm'],
    systemOps: [],
    whitelistDigests: [],
  })) as unknown as Record<string, unknown>;
  await sendNodeHeartbeat({
    baseUrl: config.controlPlaneUrl,
    participantId: config.participantId,
    certFingerprint: nodePollerEnv().certFingerprint,
    privateKey: identity.privateKey,
    advertisement,
  });
  return advertisement;
}

/**
 * 单次证明探针（D-TEE-6：作业之前的证明登记）：真跑一次证明 → 交校验方验 quote →
 * 核对它回传的背书确实是给本节点、本次这份证明的。`serve` 的循环里做的是同一件事；
 * 单独成命令是为了上线自检与取证时能一步一步看。
 */
export async function probeCommand(): Promise<AttestationProbeOutcome> {
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
  });
  return runAttestationProbe({
    node: identity.urn,
    participantId: config.participantId,
    privateKey: identity.privateKey,
    provider: createAttestationProvider(config, tdxRegistryFromEnv()),
    verifierUrl: (process.env.TEE_NODE_VERIFIER_URL ?? '').trim(),
    kmsPublicKey: config.kmsPublicKey,
  });
}

/**
 * 长驻运行（任务 3.18）：装配 + 启动循环，直到收到 SIGINT/SIGTERM。
 *
 * 三个刻意的行为：
 *  - **配置不全起不来**（装配期 fail-closed：缺平台公钥/注册中心公钥/证书指纹/参与方登记表都会报错）；
 *  - **收到信号先停循环再退出**（等在途一轮结束，避免停在下发与投递之间）；
 *  - 打印一行启动摘要（含是否跑探针、清单条数、模块库大小），便于运维核对「这台机器在干什么」。
 */
export async function serveCommand(): Promise<{ stopped: boolean }> {
  const { createTrustedNodeAssembly } = await import('./assembly');
  const assembly = createTrustedNodeAssembly(teeNodeWiringFromEnv());
  const stop = () => {
    void assembly.runtime.stop().then(() => {
      console.log('可信空间节点已停止（在途一轮已收尾）');
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(
    `可信空间节点启动：${assembly.identity.urn}｜` +
      `清单 ${assembly.operators.manifestCount()} 条｜` +
      `探针 ${process.env.TEE_NODE_VERIFIER_URL ? '已配置' : '未配置（不跑）'}`,
  );
  assembly.runtime.start();
  // 循环自带长轮询，这里只挂着等信号；`stop()` 之后 `start()` 的 promise 自然结束。
  await assembly.runtime.waitUntilStopped();
  return { stopped: true };
}

async function main(): Promise<void> {
  // `pnpm run <script> -- keygen` 会把 `--` 也传给 ts-node，命令行里可能出现空串或分隔符；
  // 因此按「出现的第一个已知子命令」解析，而不是死取 argv[2]。
  const args = process.argv.slice(2).filter((a) => a && a !== '--');
  const command = args.find((a) =>
    ['keygen', 'advertise', 'export-receipts', 'register', 'heartbeat', 'probe', 'serve'].includes(a),
  );
  if (command === 'keygen') {
    const out = keygenCommand();
    console.log(`节点身份已就绪：${out.urn}`);
    console.log(`公钥（注册时只提交它）：${out.publicKey}`);
    console.log(`kid：${out.kid}`);
    console.log(`私钥文件：${out.keyFile}（权限 0600，平台永不接触）`);
    return;
  }
  if (command === 'advertise') {
    console.log(JSON.stringify(await advertiseCommand(), null, 2));
    return;
  }
  if (command === 'serve') {
    await serveCommand();
    return;
  }
  if (command === 'export-receipts') {
    const jobId = args[args.indexOf('export-receipts') + 1] ?? '';
    if (!jobId) {
      console.error('用法：tee-node -- export-receipts <jobId>');
      process.exitCode = 2;
      return;
    }
    const out = exportReceiptsCommand(jobId);
    console.log(`已导出 ${out.count} 条回执 → ${out.file}`);
    console.log(`离线核验：node apps/connector/scripts/verify-receipt-chain.mjs --receipts ${out.file} --pubkey <节点公钥>`);
    return;
  }
  if (command === 'register') {
    const token = args[args.indexOf('--token') + 1] ?? '';
    const out = await registerCommand(token);
    console.log(`节点已注册（只提交了公钥）：${out.urn}`);
    console.log(`  公钥       ${out.publicKey}`);
    console.log(`  证书指纹   ${out.fingerprint || '(未返回)'}`);
    console.log(`请把指纹写进部署配置：TEE_NODE_CERT_FINGERPRINT=${out.fingerprint}`);
    if (out.warnedAboutPrivateKey) {
      console.error('[严重] 平台响应里出现了私钥字段 —— 这违反「参与方密钥自持」，请立即排查。');
      process.exitCode = 2;
    }
    return;
  }
  if (command === 'probe') {
    const out = await probeCommand();
    console.log(
      JSON.stringify(
        {
          accepted: out.accepted,
          endorsed: out.endorsed,
          expiresAt: out.expiresAt ?? null,
          detail: out.detail ?? null,
          kind: out.report.kind,
          measurement: out.report.measurement,
          tcb: out.report.tcb,
          quote_digest: out.report.quote_digest,
        },
        null,
        2,
      ),
    );
    if (!out.endorsed) process.exitCode = 1;
    return;
  }
  if (command === 'heartbeat') {
    const advertisement = await heartbeatCommand();
    console.log(`心跳已上报；能力通告：tee=${JSON.stringify(advertisement.tee)}`);
    return;
  }
  console.error('用法：tee-node -- <keygen|advertise|export-receipts <jobId>|register --token <jwt>|heartbeat|probe|serve>');
  process.exitCode = 2;
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(`[tee-node] ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
