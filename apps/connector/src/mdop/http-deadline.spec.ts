import { HttpDeadlineError, withHttpDeadline } from './http-deadline';

/**
 * 出站请求的总时限（2026-10-07 真机事故回归）：滴流的响应触发不了运行时自带的空闲超时，
 * 必须由调用方给整个请求（含读响应体）定一个上限。
 */
describe('出站请求总时限', () => {
  it('时限内完成 → 原样返回结果，且不留定时器', async () => {
    jest.useFakeTimers();
    try {
      const out = await withHttpDeadline('探测', 1_000, async () => 'ok');
      expect(out).toBe('ok');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('到点仍未完成 → 抛超时并把中止信号交给实现（真实 fetch 会据此断开连接）', async () => {
    let seen: AbortSignal | undefined;
    const started = Date.now();
    await expect(
      withHttpDeadline('节点长轮询', 30, (signal) => {
        seen = signal;
        return new Promise<never>(() => undefined); // 永不返回：不理会信号的实现也必须被放行
      }),
    ).rejects.toBeInstanceOf(HttpDeadlineError);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen?.aborted).toBe(true);
    expect((seen?.reason as Error).message).toMatch(/节点长轮询超时：30ms/);
  });

  it('实现自己的失败原样抛出（不被包装成超时）', async () => {
    await expect(
      withHttpDeadline('探测', 1_000, async () => {
        throw new Error('fetch failed');
      }),
    ).rejects.toThrow('fetch failed');
  });

  it('超时之后实现才失败 → 不产生未处理的拒绝', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(
        withHttpDeadline(
          '探测',
          10,
          () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late')), 40)),
        ),
      ).rejects.toBeInstanceOf(HttpDeadlineError);
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
