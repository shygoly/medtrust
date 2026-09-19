import { Injectable, Logger } from "@nestjs/common";

interface Waiter {
  participantId: string;
  resolve?: (reason: "notified" | "timeout") => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface NotifierWaiter {
  /** 等到被唤醒或超时。未超时返回 "notified"。 */
  wait(ms: number): Promise<"notified" | "timeout">;
  /** 注销（拿到任务提前返回时调用）。 */
  dispose(): void;
}

/**
 * 长轮询唤醒登记（design D2）。
 *
 * 调用顺序必须为：`begin()` 登记 → 再查待办 → 有待办就 `dispose()` 立即返回，
 * 否则 `wait(ms)`。先登记再查，才不会漏掉"查完没有、正要登记时刚好来了任务"。
 *
 * 登记在进程内存：当前单实例部署；多实例需改发布订阅（见 design Open Questions）。
 */
@Injectable()
export class ConnectorTaskNotifier {
  private readonly logger = new Logger(ConnectorTaskNotifier.name);
  private readonly waiters = new Map<string, Set<Waiter>>();

  begin(participantId: string): NotifierWaiter {
    const waiter: Waiter = { participantId };
    const set = this.waiters.get(participantId) ?? new Set<Waiter>();
    set.add(waiter);
    this.waiters.set(participantId, set);

    return {
      wait: (ms: number) =>
        new Promise<"notified" | "timeout">((resolve) => {
          waiter.resolve = resolve;
          waiter.timer = setTimeout(
            () => {
              this.remove(waiter);
              resolve("timeout");
            },
            Math.max(0, ms),
          );
        }),
      dispose: () => this.remove(waiter),
    };
  }

  /** 唤醒该参与方的全部等待者，返回被唤醒的数量（0 = 没有在等的请求）。 */
  notify(participantId: string): number {
    const set = this.waiters.get(participantId);
    if (!set?.size) return 0;
    const woken = [...set];
    for (const waiter of woken) {
      this.remove(waiter);
      waiter.resolve?.("notified");
    }
    this.logger.debug(
      `唤醒 ${participantId} 的长轮询等待者 ${woken.length} 个`,
    );
    return woken.length;
  }

  /** 当前在等的请求数（诊断/测试用）。 */
  waiting(participantId?: string): number {
    if (participantId) return this.waiters.get(participantId)?.size ?? 0;
    let total = 0;
    for (const set of this.waiters.values()) total += set.size;
    return total;
  }

  private remove(waiter: Waiter): void {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    const set = this.waiters.get(waiter.participantId);
    if (!set) return;
    set.delete(waiter);
    if (!set.size) this.waiters.delete(waiter.participantId);
  }
}
