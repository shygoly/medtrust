// Minimal in-memory TypeORM Repository mock for unit-testing control-plane
// services without a real datasource. Mirrors the subset the services use:
// create / save / find / findOne / update / delete / count. `create` returns a
// shallow copy (like TypeORM) so a returned DTO and the stored row are distinct
// — tests should re-fetch to observe mutations.
export function mockRepo<T extends Record<string, any> = any>() {
  const rows: T[] = [];
  const matches = (r: T, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => (r as any)[k] === v);
  return {
    create: (x: any) => (Array.isArray(x) ? x.map((i) => ({ ...i })) : { ...x }),
    save: async (x: any) => {
      const arr = Array.isArray(x) ? x : [x];
      for (const item of arr) {
        const pkField = item.assignmentId
          ? 'assignmentId'
          : item.taskId
            ? 'taskId'
            : item.id
              ? 'id'
              : null;
        const pk = pkField ? item[pkField] : null;
        if (pkField && pk) {
          const idx = rows.findIndex((r) => (r as any)[pkField] === pk);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...item };
            continue;
          }
        }
        rows.push(item as T);
      }
      return x;
    },
    find: async (opts?: any) => {
      let result = opts?.where ? rows.filter((r) => matches(r, opts.where)) : [...rows];
      const order = opts?.order as Record<string, 'ASC' | 'DESC'> | undefined;
      if (order) {
        const [field, dir] = Object.entries(order)[0] ?? [];
        if (field) {
          result = [...result].sort((a, b) => {
            const av = (a as any)[field];
            const bv = (b as any)[field];
            const cmp = av > bv ? 1 : av < bv ? -1 : 0;
            return dir === 'DESC' ? -cmp : cmp;
          });
        }
      }
      return result;
    },
    findOne: async (opts: any) => rows.find((r) => matches(r, opts?.where)) ?? null,
    update: async (where: any, patch: any) => {
      let affected = 0;
      for (const r of rows)
        if (matches(r, where)) {
          Object.assign(r, patch);
          affected++;
        }
      return { affected } as any;
    },
    delete: async (where: any) => {
      let affected = 0;
      for (let i = rows.length - 1; i >= 0; i--)
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          affected++;
        }
      return { affected } as any;
    },
    count: async (opts?: any) => (opts?.where ? rows.filter((r) => matches(r, opts.where)).length : rows.length),
  } as any;
}
