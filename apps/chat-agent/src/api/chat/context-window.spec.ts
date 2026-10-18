import { contextWindow } from './context-window';

describe('contextWindow（4.1.4 消息压缩）', () => {
  const items = [1, 2, 3, 4, 5];

  it('超出上限时只保留最近 N 条', () => {
    expect(contextWindow(items, 2)).toEqual([4, 5]);
  });

  it('未超出时原样返回，且不共享原数组引用', () => {
    const result = contextWindow(items, 10);
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('max <= 0 视为不限窗口（不是"什么都不带"）', () => {
    expect(contextWindow(items, 0)).toEqual(items);
    expect(contextWindow(items, -1)).toEqual(items);
  });

  it('空历史安全', () => {
    expect(contextWindow([], 5)).toEqual([]);
  });
});
