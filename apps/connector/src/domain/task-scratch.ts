import { Injectable } from '@nestjs/common';

// Per-task intermediate working data materialized locally during execution
// (e.g. a cohort extract). Subject to the contract's retention rule.
@Injectable()
export class TaskScratch {
  private buffers = new Map<string, unknown>();

  put(taskId: string, data: unknown): void {
    this.buffers.set(taskId, data);
  }

  has(taskId: string): boolean {
    return this.buffers.has(taskId);
  }

  purge(taskId: string): void {
    this.buffers.delete(taskId);
  }
}
