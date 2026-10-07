import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReceipt } from '@medtrust/mdop';
import type { NodeArtifactRecord } from '../mdop/node/node-artifacts';
import type { ExecutedStageEntry } from './executed-ledger';
import { NodeStateFile, NodeStateStore } from './persist';

/**
 * 节点状态的装配（任务 3.16）：把「数据目录」这一处部署配置收拢到一行。
 *
 * 目录里只有一个 `node-state.json`（回执链 + 未销毁制品 + 去重表 + 已执行阶段登记），权限 0700/0600。
 * 落盘时机由调用方决定：**一次会话结束、一次销毁之后**各落一次。
 */

export const DEFAULT_NODE_DATA_DIR = 'data/tee-node';

/** 数据目录（逐个键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。 */
export function nodeDataDir(): string {
  return (process.env.TEE_NODE_DATA_DIR ?? DEFAULT_NODE_DATA_DIR).trim() || DEFAULT_NODE_DATA_DIR;
}

export function createNodeStateStore(input: {
  receipts: {
    dump(): Array<{ jobId: string; receipts: AuditReceipt[] }>;
    import(snapshot: ReadonlyArray<{ jobId: string; receipts: readonly AuditReceipt[] }>): number;
  };
  artifacts: { dump(): NodeArtifactRecord[]; import(records: readonly NodeArtifactRecord[]): number };
  processed?: Set<string>;
  /** 已执行阶段登记（给了才落盘/恢复；见 `executed-ledger.ts`）。 */
  executed?: {
    dump(): ExecutedStageEntry[];
    import(entries: readonly ExecutedStageEntry[] | undefined): number;
  };
  dir?: string;
}): NodeStateStore {
  const file = new NodeStateFile({ dir: input.dir ?? nodeDataDir() });
  return new NodeStateStore(file, {
    receipts: input.receipts,
    artifacts: input.artifacts,
    ...(input.processed ? { processed: input.processed } : {}),
    ...(input.executed ? { executed: input.executed } : {}),
  });
}

/**
 * 导出某作业的回执链（离线核验工具的输入形状），返回写入的文件路径与条数。
 *
 * 给了 `store` 就先 `hydrate()`：保证导出的是**盘上那份**（节点重启后内存是空的，
 * 但一手链在盘上）；文件用与状态文件同一套权限口径（0600）。
 */
export function exportReceiptsForJob(input: {
  jobId: string;
  receipts: { list(jobId: string): readonly AuditReceipt[] };
  store?: NodeStateStore;
  dir?: string;
}): { file: string; count: number } {
  input.store?.hydrate();
  const receipts = [...input.receipts.list(input.jobId)];
  const dir = input.dir ?? nodeDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `receipts-${input.jobId.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  writeFileSync(file, JSON.stringify({ receipts }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  return { file, count: receipts.length };
}
