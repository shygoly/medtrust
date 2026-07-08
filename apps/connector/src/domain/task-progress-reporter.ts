import { Injectable } from '@nestjs/common';

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

/** Scoped progress sink for one assignment execution. */
@Injectable()
export class TaskProgressReporter {
  private sink: ProgressSink | null = null;

  bind(sink: ProgressSink): void {
    this.sink = sink;
  }

  clear(): void {
    this.sink = null;
  }

  async stage(stage: ConnectorProgressStage, detail?: string): Promise<void> {
    await this.sink?.(stage, detail);
  }
}
