// 存证账本用例专用的内存假仓。不复用 runtime/test-utils/mock-repo：那一份按
// `assignmentId → taskId → id` 猜主键，而存证指针的 `taskId` 是归属对象 id、不是主键，
// 两条指针指向同一任务会被它误并成一行。
export function fakeRepo<T extends Record<string, any>>(seed: T[] = []) {
  const rows: T[] = seed.map((r) => ({ ...r }));
  let seq = 0;
  const matches = (row: T, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([k, v]) =>
      v === null || v === undefined
        ? row[k] === null || row[k] === undefined
        : row[k] === v,
    );
  return {
    rows,
    create: (x: Partial<T>): T => ({ ...(x as T) }),
    save: async (x: T): Promise<T> => {
      const row = x as Record<string, any>;
      if (!row.id && !row.taskId && !row.assignmentId) row.id = `gen-${++seq}`;
      if (!row.id && "hash" in row) row.id = `gen-${++seq}`;
      if (!row.at && "hash" in row) row.at = new Date();
      const i = rows.findIndex((r) => r === x || (row.id && r.id === row.id));
      if (i >= 0) rows[i] = x;
      else rows.push(x);
      return x;
    },
    find: async (opts?: { where?: Record<string, unknown> }): Promise<T[]> =>
      rows.filter((r) => matches(r, opts?.where)),
    count: async (): Promise<number> => rows.length,
    findOne: async (opts: {
      where: Record<string, unknown>;
    }): Promise<T | null> => rows.find((r) => matches(r, opts.where)) ?? null,
    update: async (where: Record<string, unknown>, patch: Partial<T>) => {
      let affected = 0;
      for (const r of rows)
        if (matches(r, where)) {
          Object.assign(r, patch);
          affected += 1;
        }
      return { affected };
    },
  } as any;
}
