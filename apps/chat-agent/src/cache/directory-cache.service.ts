import { Inject, Injectable } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service';
import { KEY_VALUE_STORE, type KeyValueStore } from '../store/key-value.store';
import type { SpaceDirectory } from '../agent/directory';

export const DIRECTORY_CACHE_TTL = 'DIRECTORY_CACHE_TTL';

/**
 * 目录缓存（4.1.2）。
 *
 * 目录（参与方 / 数据产品元数据）在一次对话里要被读一次，而它变化很慢——
 * 每次对话都打一次控制面纯属浪费。TTL 到期自然失效，不做主动失效：
 * 目录更新延迟 ≤ TTL 是可接受代价（卡片里会显示候选，用户不会因此提交错东西）。
 */
@Injectable()
export class DirectoryCache {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(DIRECTORY_CACHE_TTL) private readonly ttlSeconds: number,
    private readonly metrics: MetricsService,
  ) {}

  private key(spaceId: string): string {
    return `directory:${spaceId}`;
  }

  async get(spaceId: string): Promise<SpaceDirectory | null> {
    if (this.store.kind === 'disabled') {
      this.metrics.increment('cache_misses_total', { name: 'directory', reason: 'disabled' });
      return null;
    }
    const hit = await this.store.get<SpaceDirectory>(this.key(spaceId));
    this.metrics.increment('cache_' + (hit ? 'hits' : 'misses') + '_total', { name: 'directory' });
    return hit;
  }

  async set(spaceId: string, directory: SpaceDirectory): Promise<void> {
    if (this.store.kind === 'disabled') return;
    await this.store.set(this.key(spaceId), directory, this.ttlSeconds);
  }

  async invalidate(spaceId: string): Promise<void> {
    await this.store.del(this.key(spaceId));
  }
}
