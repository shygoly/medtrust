import { Logger } from '@nestjs/common';
import type { KeyReleaseWarrant } from '@medtrust/mdop';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopOutboundClient } from '../mdop/mdop-client';
import { NodeQueryBudgetLedger, type BudgetKey, type BudgetPolicy } from '../mdop/node/budget-ledger';
import { TrustedNodeEntryGuard } from '../mdop/node/entry-guard';
import { NodeArtifactStore } from '../mdop/node/node-artifacts';
import { NodeExitGuard } from '../mdop/node/node-exit';
import { NodeReceiptChain } from '../mdop/node/node-receipts';
import { TrustedNodeSession } from '../mdop/node/node-session';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { runAttestationProbe } from './attestation-probe';
import { loadTeeNodeConfig, type TeeNodeConfig } from './config';
import { createNodeExecutor } from './executor';
import { NODE_DECLASSIFY_OP } from './declassify-op';
import { loadNodeIdentity, type TeeNodeIdentity } from './identity';
import { listModuleDigests, moduleLibrary, nodeModuleEnv } from './module-library';
import { NodeContractStore } from './contract-store';
import { loadParticipantKeys, nodeParticipantKeysEnv } from './participant-keys';
import { NodeMessageRouter, type NodeMessageRouterDeps } from './node-messages';
import { NodeOperatorStore, nodeOperatorEnv } from './operator-store';
import { nodePollerEnv, pollNodeMessages } from './poller';
import {
  createAttestationProvider,
  createKmsClient,
  nodeCapabilityAdvertisement,
  type TeeNodeProviderRegistry,
} from './providers';
import { NodeReceiptReporter } from './receipt-report';
import { sendNodeHeartbeat } from './registration';
import { TrustedNodeRuntime, type NodeRuntimeOptions } from './runtime';
import { createNodeStateStore } from './state';

/**
 * 可信空间节点的**生产装配**（任务 3.18）：把配置、身份、两处接缝、清单/吊销、参与方登记表、
 * 执行面、消息路由器与长驻循环接成一个**可以真的启动**的进程。
 *
 * 这一层只接线，不放宽任何判据——每条判据都在各自模块里（复核、会话、出口、吊销、背书……）。
 * 三处必须由部署提供的事实在这里汇合：
 *  ① 校验方探针地址（`TEE_NODE_VERIFIER_URL`，缺省不跑探针——不猜地址）；
 *  ② 允许的度量（`TEE_NODE_MEASUREMENTS`，缺省为空 = 不接受任何 C2 要约）；
 *  ③ 本地模块库目录（`TEE_NODE_MODULE_DIR`，按 `<sm3hex>.wasm` 取字节）与
 *     **参与方登记公钥表**（`TEE_NODE_PARTICIPANT_KEYS_FILE`，验持有方签名的部署锚）。
 *
 * 两处**必须由调用方注入**的真实实现缺口，如实标注、不静默降级：
 *  - 真实证明代理 / 真实 KMS 客户端：未注入时 `createAttestationProvider` / `createKmsClient` 直接报错
 *    （开发替身要显式开关，且生产环境拒绝启动）；
 *  - **数据密钥解封**（`unwrapKey`）：真实部署在飞地内用一次性私钥解开；缺省只对演练 KMS 有效，
 *    别的 KMS 实现必须由部署方注入（缺省实现会以明确报错拒绝，而不是返回空密钥）。
 */

export interface NodeAssemblyOptions extends NodeRuntimeOptions {
  logger?: Logger;
  /** 覆盖探针地址（缺省读 `TEE_NODE_VERIFIER_URL`）。 */
  verifierUrl?: string;
  /** 覆盖允许度量（缺省读 `TEE_NODE_MEASUREMENTS`）。 */
  measurements?: readonly string[];
  /** 覆盖模块库目录（缺省读 `TEE_NODE_MODULE_DIR`）。 */
  moduleDir?: string;
  /** 覆盖参与方登记公钥表（缺省读 `TEE_NODE_PARTICIPANT_KEYS_FILE`）。 */
  participantKeys?: ReadonlyMap<string, string>;
  /** 数据密钥解封（真实部署在飞地内实现）。 */
  unwrapKey?: (warrant: KeyReleaseWarrant) => Uint8Array;
  /** 查询预算口径（缺省用「数据产品 × 快照」按合约推导）。 */
  stageBudget?: (input: {
    jobId: string;
    credentialId: string;
    dataProductId: string;
    applicant?: string;
    snapshot?: string;
    limit?: number;
  }) => { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string };
  /**
   * 两处可插拔接缝的注入（真实证明代理 / 真实 KMS / 演练 KMS 的密钥与信任根）。
   * 与 `providers.ts` 同一形状：**换链/换 KMS 只换这里**，装配的其他部分不动。
   */
  providers?: TeeNodeProviderRegistry;
}

/** 节点运行时的部署配置（逐键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。 */
export function nodeRuntimeEnv(): { verifierUrl: string; measurements: string[]; moduleDir: string } {
  const raw = (process.env.TEE_NODE_MEASUREMENTS ?? '').trim();
  return {
    /** 校验方的证明服务地址（探针用；**不设默认值**，缺省即不跑探针）。 */
    verifierUrl: (process.env.TEE_NODE_VERIFIER_URL ?? '').trim(),
    /** 本节点允许运行的执行环境度量（注册中心白名单的本地副本；缺省为空 = 不接受任何 C2 要约）。 */
    measurements: raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    /** 本地模块库目录（按 `<sm3hex>.wasm` 取名）。 */
    moduleDir: nodeModuleEnv().moduleDir,
  };
}

export interface TrustedNodeAssembly {
  runtime: TrustedNodeRuntime;
  config: TeeNodeConfig;
  identity: TeeNodeIdentity;
  router: NodeMessageRouter;
  operators: NodeOperatorStore;
  session: TrustedNodeSession;
  artifacts: NodeArtifactStore;
  receipts: NodeReceiptChain;
}

/** 组装一个可启动的可信空间节点（配置不全即报错，不允许「先跑起来再补配置」）。 */
export function createTrustedNodeAssembly(options: NodeAssemblyOptions = {}): TrustedNodeAssembly {
  const logger = options.logger ?? new Logger('TrustedNodeAssembly');
  const config = loadTeeNodeConfig();
  const identity = loadNodeIdentity({
    participantId: config.participantId,
    keyFile: config.keyFile,
    spaceId: config.spaceId,
  });
  const env = nodeRuntimeEnv();
  const pollerEnv = nodePollerEnv();
  const operatorEnv = nodeOperatorEnv();
  const measurements = options.measurements ?? env.measurements;
  const moduleDir = options.moduleDir ?? env.moduleDir;
  const participantKeys =
    options.participantKeys ??
    loadParticipantKeys(nodeParticipantKeysEnv().keysFile);

  if (!pollerEnv.platformPublicKey)
    throw new Error('缺少 TEE_NODE_PLATFORM_PUBKEY：节点不得处理任何无法验签的下发（fail-closed）');
  if (!operatorEnv.registryPublicKey)
    throw new Error(
      '缺少 TEE_NODE_REGISTRY_PUBKEY：算子清单一律不采纳（每个阶段都会被 E_OP_NOT_WHITELISTED 拒）',
    );
  if (!pollerEnv.certFingerprint)
    throw new Error('缺少 TEE_NODE_CERT_FINGERPRINT：节点无法通过出站认证（fail-closed）');
  if (participantKeys.size === 0)
    logger.warn('参与方登记公钥表为空：合约副本与 C2 信封的持有方签名都验不了（要约会被拒）');

  const platform = `urn:tds:${config.spaceId}:participant:platform`;
  // 登记表按 URN 建索引；合约条款里的 `provider` 是裸参与方 id、信封签署方是 URN——两种写法都要查得到
  // （只认 URN 时，随要约带来的合约副本一份都验不了，节点会把每个 C2 片段都判成 E_CONTRACT_UNSIGNED）。
  const holderPublicKey = (participant: string): string | undefined =>
    participantKeys.get(participant) ??
    participantKeys.get(`urn:tds:${config.spaceId}:participant:${participant}`);
  const outbound = new MdopOutboundClient({
    baseUrl: config.controlPlaneUrl,
    participantId: config.participantId,
    privateKey: identity.privateKey,
  });
  const receipts = new NodeReceiptChain({ node: identity.urn, privateKey: identity.privateKey });
  const artifacts = new NodeArtifactStore({ node: identity.urn, privateKey: identity.privateKey });
  const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));
  const budget = new NodeQueryBudgetLedger();
  const operators = new NodeOperatorStore({
    registryPublicKey: operatorEnv.registryPublicKey,
    platformPublicKey: pollerEnv.platformPublicKey,
    moduleBytes: moduleLibrary(moduleDir),
    logger: { warn: (m) => logger.warn(m), log: (m) => logger.log(m) },
  });
  const { executor, declassify } = createNodeExecutor({
    review,
    moduleBytes: (digest) => operators.moduleBytes(digest),
  });

  const provider = createAttestationProvider(config, options.providers ?? {});
  const kms = createKmsClient(config, options.providers ?? {});
  const unwrapKey =
    options.unwrapKey ??
    ((warrant: KeyReleaseWarrant): Uint8Array => {
      const dev = kms as { unwrapKey?(w: KeyReleaseWarrant, key: string): Uint8Array };
      const ephemeral = (provider as { lastEphemeralPrivateKey?: string }).lastEphemeralPrivateKey;
      if (!dev.unwrapKey || !ephemeral)
        throw new Error(
          '数据密钥解封未接线：真实部署须在飞地内用一次性私钥解开（部署方注入 unwrapKey）',
        );
      return dev.unwrapKey(warrant, ephemeral);
    });
  const session = new TrustedNodeSession({
    node: identity.urn,
    attestation: provider,
    kms,
    kmsPublicKey: config.kmsPublicKey,
    unwrapKey,
    entryGuard: new TrustedNodeEntryGuard(
      new Map([...participantKeys.entries()].map(([urn, key]) => [urn, key])),
    ),
    review,
    exitGuard: new NodeExitGuard(),
    receipts,
    artifacts,
    budget,
    executor,
  });

  const state = createNodeStateStore({ receipts, artifacts });
  const contracts = new NodeContractStore();
  const defaultStageBudget = options.stageBudget ?? defaultStageBudgetFactory(identity.urn);
  const routerDeps: NodeMessageRouterDeps = {
    node: identity.urn,
    platform,
    outbound,
    identity: { privateKey: identity.privateKey, publicKey: identity.publicKey },
    platformPublicKey: pollerEnv.platformPublicKey,
    participantPublicKey: holderPublicKey,
    session,
    artifacts,
    contracts,
    declassify,
    review: {
      whitelist: operators,
      capability: async () => ({
        node: identity.urn,
        runtime: ['native', 'wasm'],
        system_ops: [NODE_DECLASSIFY_OP],
        whitelist_digests: [],
        tee: await advertisedTee(provider),
        protocols: [],
      }),
      registryMeasurements: measurements,
    },
    stageContext: (input) => ({
      budget: defaultStageBudget({
        jobId: input.jobId,
        credentialId: input.credentialId,
        dataProductId: input.terms.data_product_id,
        applicant: input.applicant,
        ...(input.snapshot ? { snapshot: input.snapshot } : {}),
        ...(input.terms.publication.minCell !== undefined
          ? { limit: input.terms.publication.minCell }
          : {}),
      }),
      holderPublicKey,
    }),
    receipts: new NodeReceiptReporter({ receipts, outbound, platform }),
    state,
  };
  const router = new NodeMessageRouter(routerDeps);

  const runtime = new TrustedNodeRuntime(
    {
      node: identity.urn,
      router,
      operators,
      session,
      artifacts,
      receipts,
      state,
      poll: (input: { waitMs: number; now?: Date }) =>
        pollNodeMessages(
          {
            baseUrl: config.controlPlaneUrl,
            participantId: config.participantId,
            privateKey: identity.privateKey,
            certFingerprint: pollerEnv.certFingerprint,
            platformPublicKey: pollerEnv.platformPublicKey,
            self: identity.urn,
          },
          { waitMs: input.waitMs, ...(input.now ? { now: input.now.getTime() } : {}) },
        ),
      ...(effectiveVerifierUrl(options, env)
        ? {
            probe: () =>
              runAttestationProbe({
                node: identity.urn,
                participantId: config.participantId,
                privateKey: identity.privateKey,
                provider,
                verifierUrl: effectiveVerifierUrl(options, env),
                kmsPublicKey: config.kmsPublicKey,
              }),
          }
        : {}),
      heartbeat: async () => {
        const advertisement = await nodeCapabilityAdvertisement({
          provider,
          runtime: ['native', 'wasm'],
          systemOps: [NODE_DECLASSIFY_OP],
          // 能力通告里如实列出**本地模块库**里的模块摘要（平台据此判「这台机器能跑什么」）
          whitelistDigests: listModuleDigests(moduleDir).map((hex) => `sm3:${hex}`),
        });
        await sendNodeHeartbeat({
          baseUrl: config.controlPlaneUrl,
          participantId: config.participantId,
          certFingerprint: pollerEnv.certFingerprint,
          privateKey: identity.privateKey,
          advertisement,
        });
      },
      logger,
      now: () => new Date(),
    },
    options,
  );

  return { runtime, config, identity, router, operators, session, artifacts, receipts };
}

function effectiveVerifierUrl(options: NodeAssemblyOptions, env: { verifierUrl: string }): string {
  return options.verifierUrl ?? env.verifierUrl;
}

/** 能力通告里的 `tee`：软件提供者恒 null（真跑一次证明得出，不看配置）。 */
async function advertisedTee(
  provider: ReturnType<typeof createAttestationProvider>,
): Promise<{ kind: string; min_tcb?: string } | null> {
  const report = await provider.prove();
  if (report.level !== 'hardware' || report.isolation !== 'hardware-enclave' || !report.kind)
    return null;
  return { kind: report.kind, ...(report.tcb ? { min_tcb: report.tcb } : {}) };
}

/**
 * 缺省预算口径：每次查询成本 1；上限取合约发布阈值（缺省 3）；
 * 快照标识取**合约预审快照**（同一份数据版本一个预算桶），没有就退回一个稳定的常量桶——
 * 常量桶更严（同一数据产品的所有作业共用一个上限），不会放宽任何约束。
 * 申请方来自作业头（账本按它记账、供差分查询检测），**不拿节点自己冒充申请方**。
 */
function defaultStageBudgetFactory(node: string) {
  return (input: {
    jobId: string;
    credentialId: string;
    dataProductId: string;
    applicant?: string;
    snapshot?: string;
    limit?: number;
  }): { key: BudgetKey; policy: BudgetPolicy; cost: number; applicant: string } => ({
    key: {
      dataset: input.dataProductId,
      snapshot: input.snapshot ?? `sm3:${'0'.repeat(64)}`,
    },
    policy: { limit: input.limit ?? 3, unit: 'queries' },
    cost: 1,
    applicant: input.applicant || node,
  });
}
