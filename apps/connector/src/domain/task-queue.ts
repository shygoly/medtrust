export type QueuedJob = { label: string; run: () => Promise<void> };

/**
 * 并发上限可控的执行队列（design D2「不阻塞在线状态」）。
 *
 * 长轮询循环只负责领任务：领到就入队并立刻发起下一次长轮询，
 * 因此执行耗时任务期间连接器仍持续刷新在线状态、仍能领新任务。
 */
export class TaskExecutionQueue {
  private readonly pending: QueuedJob[] = [];
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly onError?: (job: QueuedJob, err: unknown) => void,
  ) {}

  push(job: QueuedJob): void {
    this.pending.push(job);
    this.drain();
  }

  /** 队列中尚未开始的任务数（不含执行中的）。 */
  get queued(): number {
    return this.pending.length;
  }

  /** 执行中的任务数。 */
  get running(): number {
    return this.active;
  }

  /** 等到队列清空（测试与优雅退出用）。 */
  idle(): Promise<void> {
    if (!this.active && !this.pending.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private drain(): void {
    while (this.active < Math.max(1, this.limit) && this.pending.length) {
      const job = this.pending.shift()!;
      this.active += 1;
      void job
        .run()
        .catch((err) => this.onError?.(job, err))
        .finally(() => {
          this.active -= 1;
          this.drain();
          if (!this.active && !this.pending.length) {
            for (const resolve of this.idleWaiters.splice(0)) resolve();
          }
        });
    }
  }
}
