/**
 * 滑动窗口（4.1.4）：只把最近 max 条历史送进模型。
 *
 * max <= 0 视为「不限窗口」——配置缺省已保证 > 0，这里不把 0 解读成"什么都不带"，
 * 否则一个 0 值配置会让助手突然失忆，且原因极难定位。
 */
export function contextWindow<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [...items];
  return items.length <= max ? [...items] : items.slice(items.length - max);
}
