import { Global, Module } from '@nestjs/common';
import { AGENT_CONFIG, type MedTrustChatConfig } from '../config/agent.config';
import { MetricsService } from '../observability/metrics.service';
import {
  InMemoryRateLimitStore,
  RATE_LIMIT_STORE,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../common/rate-limit.store';
import {
  createRedisKeyValueStore,
  KEY_VALUE_STORE,
  NullKeyValueStore,
  type KeyValueStore,
} from './key-value.store';

/**
 * 共享存储（Redis）装配。
 *
 * 做成 @Global 是因为它有两个消费者：ChatModule（目录缓存 / 限流守卫）与
 * HealthModule（就绪探针要如实报告用的是哪种实现）。
 */
@Global()
@Module({
  providers: [
    {
      provide: KEY_VALUE_STORE,
      inject: [AGENT_CONFIG],
      useFactory: async (config: MedTrustChatConfig): Promise<KeyValueStore> => {
        if (!config.redisUrl) return new NullKeyValueStore();
        // 配置了 Redis 却连不上 = 部署错误：直接抛，拒绝启动。
        // 静默退回每实例限流会让"共享配额"变成一句谎话。
        return createRedisKeyValueStore({
          url: config.redisUrl,
          keyPrefix: config.redisKeyPrefix,
        });
      },
    },
    {
      provide: RATE_LIMIT_STORE,
      inject: [KEY_VALUE_STORE, MetricsService],
      useFactory: (store: KeyValueStore, metrics: MetricsService): RateLimitStore =>
        store.kind === 'redis'
          ? new RedisRateLimitStore(store, metrics)
          : new InMemoryRateLimitStore(),
    },
  ],
  exports: [KEY_VALUE_STORE, RATE_LIMIT_STORE],
})
export class StoreModule {}
