import { TaskExecutionQueue } from './task-queue';

describe('TaskExecutionQueue — 并发上限与 FIFO', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('并发不超过上限,且按入队顺序开始', async () => {
    const queue = new TaskExecutionQueue(2);
    const started: string[] = [];
    let concurrent = 0;
    let peak = 0;
    for (const label of ['a', 'b', 'c', 'd']) {
      queue.push({
        label,
        run: async () => {
          started.push(label);
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await tick();
          concurrent -= 1;
        },
      });
    }
    await queue.idle();
    expect(peak).toBeLessThanOrEqual(2);
    expect(started.slice(0, 2)).toEqual(['a', 'b']);
    expect(started).toHaveLength(4);
  });

  it('一个任务抛错不影响后续任务', async () => {
    const errors: string[] = [];
    const queue = new TaskExecutionQueue(1, (job) => errors.push(job.label));
    const done: string[] = [];
    queue.push({ label: 'boom', run: async () => { throw new Error('x'); } });
    queue.push({ label: 'ok', run: async () => { done.push('ok'); } });
    await queue.idle();
    expect(errors).toEqual(['boom']);
    expect(done).toEqual(['ok']);
  });
});
