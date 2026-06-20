// 把显示名规范成稳定 slug key。用于 seeder 的 warn-only 引用解析,
// 以及(可选)校验 canonical 条目 key 的一致性。
export function toKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[\s/_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
