import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type ConnectorProgressStage =
  | 'pulled'
  | 'catalog-prefetch'
  | 'data-load'
  | 'pep-check'
  | 'compute'
  | 'output-gate'
  | 'retention'
  | 'complete'
  | 'failed';

export type ProgressSink = (stage: ConnectorProgressStage, detail?: string) => Promise<void> | void;

/**
 * Scoped progress sink for one assignment execution.
 *
 * 用 AsyncLocalStorage 隔离每个任务的 sink：长轮询主循环把任务交给并发执行队列后，
 * 多个任务同时在跑，全局单例 sink 会把进度张冠李戴（outbound-longpoll-agent-auth D2）。
 */
@Injectable()
export class TaskProgressReporter {
  private readonly als = new AsyncLocalStorage<ProgressSink>();

  /** 在给定 sink 的作用域内执行任务；该任务的 stage() 都会路由到这个 sink。 */
  withSink<T>(sink: ProgressSink, fn: () => Promise<T>): Promise<T> {
    return this.als.run(sink, fn);
  }

  /** 兼容旧调用点：绑定当前 async 上下文的 sink（等价于 withSink 的轻量形式）。 */
  bind(sink: ProgressSink): void {
    this.als.enterWith(sink);
  }

  clear(): void {
    this.als.enterWith(() => undefined);
  }

  async stage(stage: ConnectorProgressStage, detail?: string): Promise<void> {
    await this.als.getStore()?.(stage, detail);
  }
}
