import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReceipt } from '@medtrust/mdop';
import type { NodeArtifactRecord } from '../mdop/node/node-artifacts';

/**
 * 节点本地状态的**落盘**（任务 3.16）。
 *
 * 为什么必须落盘：节点是长期在线的参与方，而「我处理过什么、在什么代码下、销毁了没有」
 * 的第一手证据就在本地回执链里。此前它只在内存（重启即丢），于是
 * ① 离线核验只能从平台副本导出；② 已处理的 `msg_id` 去重丢失，重启后同一封中继可能重跑。
 *
 * 三条硬要求：
 *  ① 目录 `0700`、文件 `0600`（与私钥同一口径：组/其他可读即拒）；
 *  ② **原子写**（先写临时文件再 rename），避免半份状态被当成完整状态读进来；
 *  ③ `processed`（去重表）带 TTL 清理，防止无限增长。
 *
 * 状态里**只有摘要与标识**（回执、制品句柄与 C3 载荷、已处理消息 id）——
 * 没有私钥、没有明文投影；C2 的解封明细从不进入这里。
 */

export const NODE_STATE_VERSION = 1 as const;

export interface NodeStateSnapshot {
  version: typeof NODE_STATE_VERSION;
  /** 每个作业的回执链（原序）。 */
  receipts: Array<{ jobId: string; receipts: AuditReceipt[] }>;
  /** 未销毁的制品（含 C3 载荷）。 */
  artifacts: NodeArtifactRecord[];
  /** 已处理的中继消息 id（去重；带时间便于 TTL 清理）。 */
  processed: Array<{ id: string; at: string }>;
}

export function emptyNodeState(): NodeStateSnapshot {
  return { version: NODE_STATE_VERSION, receipts: [], artifacts: [], processed: [] };
}

export class NodeStateFile {
  private readonly file: string;
  constructor(
    private readonly opts: {
      dir: string;
      /** 去重表的保留时长（缺省 24 小时）。 */
      processedTtlMs?: number;
      now?: () => Date;
    },
  ) {
    this.file = join(opts.dir, 'node-state.json');
  }

  path(): string {
    return this.file;
  }

  /** 读快照：文件不存在 → 空状态；内容非法 → **拒**（不静默当成空，否则等于悄悄丢历史）。 */
  load(): NodeStateSnapshot {
    let raw: string;
    try {
      statSync(this.file);
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return emptyNodeState();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`节点状态文件不是合法 JSON：${this.file}`);
    }
    if (!parsed || typeof parsed !== 'object') throw new Error(`节点状态文件格式非法：${this.file}`);
    const state = parsed as Partial<NodeStateSnapshot>;
    if (state.version !== NODE_STATE_VERSION)
      throw new Error(`节点状态文件版本不符（期望 ${NODE_STATE_VERSION}）：${String(state.version)}`);
    return {
      version: NODE_STATE_VERSION,
      receipts: Array.isArray(state.receipts) ? state.receipts : [],
      artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
      processed: Array.isArray(state.processed) ? state.processed : [],
    };
  }

  /** 原子写：目录 0700、文件 0600；先写临时文件再 rename。 */
  save(snapshot: NodeStateSnapshot): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.opts.dir, 0o700);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** 清理过期的去重条目（返回保留后的快照与清理条数）。 */
  pruneProcessed(snapshot: NodeStateSnapshot): { snapshot: NodeStateSnapshot; removed: number } {
    const now = this.opts.now?.() ?? new Date();
    const ttl = this.opts.processedTtlMs ?? 24 * 3_600_000;
    const kept = snapshot.processed.filter((p) => now.getTime() - Date.parse(p.at) <= ttl);
    return { snapshot: { ...snapshot, processed: kept }, removed: snapshot.processed.length - kept.length };
  }
}

/**
 * 把内存 store 与落盘文件接起来：启动时 hydrate、变更后 persist。
 *
 * 刻意做成显式调用（而不是给 store 加写盘钩子）：**什么时候落盘是调用方的事**——
 * 一次会话结束、一次销毁之后各落一次，比「每次 append 都写盘」既省又清楚。
 */
export class NodeStateStore {
  constructor(
    private readonly file: NodeStateFile,
    private readonly stores: {
      receipts: {
        dump(): Array<{ jobId: string; receipts: AuditReceipt[] }>;
        import(snapshot: ReadonlyArray<{ jobId: string; receipts: readonly AuditReceipt[] }>): number;
      };
      artifacts: { dump(): NodeArtifactRecord[]; import(records: readonly NodeArtifactRecord[]): number };
      /** 可选的去重表（中继消息 id）。 */
      processed?: Set<string>;
    },
  ) {}

  /** 启动时恢复：返回恢复的条数（回执 / 制品 / 去重）。 */
  hydrate(): { receipts: number; artifacts: number; processed: number } {
    const snapshot = this.file.load();
    const receipts = this.stores.receipts.import(snapshot.receipts);
    const artifacts = this.stores.artifacts.import(snapshot.artifacts);
    if (this.stores.processed) for (const item of snapshot.processed) this.stores.processed.add(item.id);
    return { receipts, artifacts, processed: snapshot.processed.length };
  }

  /** 变更后落盘（先清理过期的去重条目）。 */
  persist(): { processed: number; removed: number } {
    const current = this.file.load();
    const snapshot: NodeStateSnapshot = {
      version: NODE_STATE_VERSION,
      receipts: this.stores.receipts.dump(),
      artifacts: this.stores.artifacts.dump(),
      processed: this.stores.processed
        ? [...this.stores.processed].map((id) => ({
            id,
            // 旧条目的时间沿用既有快照：每次 persist 都刷新时间会让 TTL 永远不过期
            at: current.processed.find((p) => p.id === id)?.at ?? new Date().toISOString(),
          }))
        : current.processed,
    };
    const { snapshot: pruned, removed } = this.file.pruneProcessed(snapshot);
    this.file.save(pruned);
    return { processed: pruned.processed.length, removed };
  }
}
