'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * SSE 通知流。只把事件当成“刷新信号”：数据仍从 REST 查询，
 * 这样重连/多标签页/漏事件都不会造成本地状态漂移。
 */
export function useNotificationStream(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let stopped = false;
    let controller: AbortController | null = null;
    let retryMs = 1_000;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        // 组件卸载时不等待，交给 abort 结束循环。
        if (stopped) {
          window.clearTimeout(timer);
          resolve();
        }
      });

    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const response = await api.openNotificationStream(controller.signal);
          if (!response.ok || !response.body) {
            throw new Error(`notification stream HTTP ${response.status}`);
          }
          retryMs = 1_000;
          invalidate();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const event = parseFrame(frame);
              if (event && event.event !== 'heartbeat') invalidate();
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch {
          if (stopped) return;
          await sleep(retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [enabled, queryClient]);
}

function parseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!event && data.length === 0) return null;
  return { event, data: data.join('\n') };
}
