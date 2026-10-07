/**
 * 出站 HTTP 请求的**总时限**：连接、响应头、响应体一并计时，到点即中止。
 *
 * 为什么要自己套一层：Node 自带 `fetch`（undici）只有「空闲超时」——响应头 300 秒、响应体
 * 两块数据之间 300 秒。一个**滴流**的响应（每隔一阵来几个字节）永远触发不了它：2026-10-07
 * 真机上节点的一次长轮询响应 5.2MB、链路约 1KB/分钟，节点就这样挂了好几分钟，既不报错也不重试。
 * 节点与连接器的出站循环都是**串行**的（心跳 → 轮询 → 逐条处置），一个请求不返回，整个进程就静默。
 *
 * 两条刻意的做法：
 *  - 时限覆盖**读响应体**：`run` 里要把 `res.json()` / `res.text()` 一起做完再返回；
 *  - 既把中止信号交给实现（真实 `fetch` 会据此断开连接），**又**用竞速保证调用方一定被放行——
 *    不依赖具体实现是否理会信号（替身、代理、老版本运行时都可能不理会）。
 */
export class HttpDeadlineError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label}超时：${timeoutMs}ms 内没有收完响应，已中止`);
    this.name = 'HttpDeadlineError';
  }
}

export async function withHttpDeadline<T>(
  label: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    // 不 `unref()`：等待期间它可能是事件循环里唯一的活动句柄（见 `tee-node/runtime.ts` 的 sleep 注释）
    timer = setTimeout(
      () => {
        const err = new HttpDeadlineError(label, timeoutMs);
        controller.abort(err);
        reject(err);
      },
      Math.max(1, timeoutMs),
    );
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 响应体在一个进展窗口内收到的字节数低于下限（滴流 / 卡死）。 */
export class HttpStallError extends Error {
  constructor(
    readonly label: string,
    readonly windowMs: number,
    readonly receivedBytes: number,
    readonly minBytes: number,
  ) {
    super(
      `${label}超时：响应体 ${windowMs}ms 内只收到 ${receivedBytes} 字节（下限 ${minBytes}），已中止`,
    );
    this.name = 'HttpStallError';
  }
}

export interface BodyProgressGuard {
  /** 进展窗口（毫秒）。 */
  windowMs: number;
  /** 每个窗口至少要收到的字节数；首个窗口只要求「有字节到」（首包可能在窗口尾部才到）。 */
  minBytesPerWindow: number;
  /** 读响应体的总上限（毫秒）：再慢也不无限等。 */
  maxTotalMs: number;
  /** 判定卡死 / 超限时回调（调用方据此断开连接）。 */
  onAbort?: (err: Error) => void;
}

/**
 * 读完响应体并按 JSON 解析，超时按**进展**判而不是按总时长判。
 *
 * 为什么不沿用总时限：大批次在慢链路上是「慢但一直在传」（2026-10-07 真机：1.3MB 的批次经跨境链路
 * 约 15KB/s，要 90 秒左右），固定的总时限会把它反复掐断、永远收不完；而要堵的事故是**滴流**
 * （约 1KB/分钟，永不空闲也永远收不完）。两者的区别在速率，不在总时长——所以按窗口内的进展判。
 *
 * 实现不提供可读流（测试替身只给 `json()`）时退回总时限 `maxTotalMs`。
 */
export async function readJsonWithProgressGuard<T>(
  label: string,
  res: Response,
  guard: BodyProgressGuard,
): Promise<T> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    try {
      return await withHttpDeadline(label, guard.maxTotalMs, () => res.json() as Promise<T>);
    } catch (err) {
      if (err instanceof HttpDeadlineError) guard.onAbort?.(err);
      throw err;
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let atLastTick = 0;
  let ticks = 0;
  let aborted: Error | undefined;
  const started = Date.now();
  // 不 `unref()`：读响应体期间它可能是事件循环里唯一的活动句柄
  const timer = setInterval(
    () => {
      ticks += 1;
      const got = total - atLastTick;
      atLastTick = total;
      const progressing = ticks === 1 ? total > 0 : got >= guard.minBytesPerWindow;
      if (!progressing) {
        aborted = new HttpStallError(label, guard.windowMs, got, guard.minBytesPerWindow);
      } else if (Date.now() - started >= guard.maxTotalMs) {
        aborted = new HttpDeadlineError(label, guard.maxTotalMs);
      }
      if (aborted) {
        clearInterval(timer);
        guard.onAbort?.(aborted);
        void reader.cancel(aborted).catch(() => undefined);
      }
    },
    Math.max(1, guard.windowMs),
  );
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (aborted) throw aborted;
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch (err) {
    // 连接被我们自己断开时，读取会以中止原因失败——统一抛判定时的那个错误
    throw aborted ?? err;
  } finally {
    clearInterval(timer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

