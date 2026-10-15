/**
 * 本地/测试用**模块客户端替身**（D10.4）：把复现构建清单里的模块当成平台下发的模块。
 *
 * 为什么需要：L1.5/因果类的系统算子（`registerL15Operators` 等）通过 `AlgorithmSandboxExecutor`
 * 跑 wasm 模块，而后者依赖 `ConnectorModuleClient ← ControlPlaneClient`（从平台取并**验签**模块）。
 * 本地跑（demo/spec）没有控制面，故用测试 CA 自签并把它设为本地信任根。
 *
 * 仅限本地/测试：它把 `CONNECTOR_REGISTRY_PUBKEY` 指向自签 CA（生产装配绝不可用）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import type { ControlPlaneClient } from '../domain/control-plane-client';
import { ConnectorModuleClient } from '../domain/sandbox/module-client';
import { newTestCa } from '../domain/sandbox/__fixtures__/platform-module';

interface ManifestEntry {
  analysisType: string;
  file: string;
  sm3: string;
  abiVersion: number;
}

/** 进程内单例：同一进程里多次装配必须共用**同一个**本地 CA（否则后设置的公钥会覆盖先前的，
 *  导致先前那台的模块验签失败 —— 这是多院 demo 踩过的坑）。 */
let cachedCa: ReturnType<typeof newTestCa> | undefined;

export function createLocalModuleClient(moduleDir: string): ConnectorModuleClient {
  const ca = (cachedCa ??= newTestCa());
  process.env.CONNECTOR_REGISTRY_PUBKEY = ca.publicKey;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(moduleDir, 'manifest.json'), 'utf8'),
  ) as { modules: ManifestEntry[] };
  const controlPlane = {
    fetchModule: async (sm3: string) => {
      const bare = String(sm3).replace(/^sm3:/, '');
      const entry = manifest.modules.find((m) => m.sm3 === bare);
      if (!entry) throw new Error(`本地模块库没有该摘要：${sm3}`);
      const bytes = fs.readFileSync(path.join(moduleDir, entry.file));
      return {
        analysisType: entry.analysisType,
        sm3: entry.sm3,
        signature: ca.sign(bytes),
        abiVersion: entry.abiVersion,
        bytes: Buffer.from(bytes).toString('base64'),
      };
    },
  } as unknown as ControlPlaneClient;
  return new ConnectorModuleClient(controlPlane, new AuditService());
}
