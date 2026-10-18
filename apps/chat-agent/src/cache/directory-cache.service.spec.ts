import { MetricsService } from '../observability/metrics.service';
import { NullKeyValueStore } from '../store/key-value.store';
import { FakeKeyValueStore } from '../test-utils/key-value-store.fake';
import { DirectoryCache } from './directory-cache.service';

const directory = { participants: [{ id: 'p-a', name: 'A' }], dataProducts: [] };

describe('DirectoryCache（4.1.2）', () => {
  it('配了存储：写入后可读，并按配置的 TTL 下发', async () => {
    const store = new FakeKeyValueStore();
    const cache = new DirectoryCache(store, 300, new MetricsService());
    expect(await cache.get('sh-med')).toBeNull();

    await cache.set('sh-med', directory);
    expect(await cache.get('sh-med')).toEqual(directory);
    expect(store.ttls.get('directory:sh-med')).toBe(300);
  });

  it('命中/未命中分别计数（可观测"缓存到底有没有用"）', async () => {
    const store = new FakeKeyValueStore();
    const metrics = new MetricsService();
    const cache = new DirectoryCache(store, 300, metrics);

    await cache.get('sh-med');
    await cache.set('sh-med', directory);
    await cache.get('sh-med');

    const text = metrics.render();
    expect(text).toMatch(/cache_misses_total\{[^}]*name="directory"[^}]*\} 1/);
    expect(text).toMatch(/cache_hits_total\{[^}]*name="directory"[^}]*\} 1/);
  });

  it('未配置存储：恒未命中、写是空操作，且计数标注 reason=disabled', async () => {
    const metrics = new MetricsService();
    const cache = new DirectoryCache(new NullKeyValueStore(), 300, metrics);

    await cache.set('sh-med', directory);
    expect(await cache.get('sh-med')).toBeNull();
    expect(metrics.render()).toMatch(/cache_misses_total\{[^}]*reason="disabled"[^}]*\} 1/);
  });

  it('invalidate 删键（目录变更时的手动失效口）', async () => {
    const store = new FakeKeyValueStore();
    const cache = new DirectoryCache(store, 300, new MetricsService());
    await cache.set('sh-med', directory);
    await cache.invalidate('sh-med');
    expect(await cache.get('sh-med')).toBeNull();
  });
});
