import { useEffect, useRef, useCallback, useState } from 'react';
import type { WebSocketMessage, TaskStatusUpdate } from '@/types/compute-task.types';
import { resolveWsBase } from '@/lib/endpoints';

// 连接时再解析：同源部署需要读 window.location（SSR 阶段没有）。
const wsBaseUrl = () =>
  resolveWsBase(
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021/api/v1',
    process.env.NEXT_PUBLIC_WS_URL,
    typeof window !== 'undefined' ? window.location : undefined,
  );

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 5000,
    maxReconnectAttempts = 10,
  } = options;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');

    try {
      const ws = new WebSocket(`${wsBaseUrl()}/ws`);

      ws.onopen = () => {
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          onMessage?.(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        onDisconnect?.();

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        setStatus('error');
        onError?.(error);
      };

      wsRef.current = ws;
    } catch (err) {
      setStatus('error');
      console.error('Failed to connect WebSocket:', err);
    }
  }, [onMessage, onConnect, onDisconnect, onError, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, []);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  const subscribe = useCallback((taskId: string) => {
    return send({
      type: 'subscribe',
      taskId,
      timestamp: new Date().toISOString(),
    } as any);
  }, [send]);

  const unsubscribe = useCallback((taskId: string) => {
    return send({
      type: 'unsubscribe',
      taskId,
      timestamp: new Date().toISOString(),
    } as any);
  }, [send]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    send,
    subscribe,
    unsubscribe,
  };
}

// 任务特定的 WebSocket Hook
export function useTaskWebSocket(taskId?: string) {
  const [statusUpdate, setStatusUpdate] = useState<TaskStatusUpdate | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'status_update':
        if (message.data) {
          setStatusUpdate(message.data);
          if (message.data.progress !== undefined) {
            setProgress(message.data.progress);
          }
        }
        break;
      case 'progress_update':
        if (message.data?.progress !== undefined) {
          setProgress(message.data.progress);
        }
        break;
      case 'log':
        if (message.data?.message) {
          setLogs(prev => [...prev, message.data.message]);
        }
        break;
      case 'connected':
        setConnected(true);
        break;
    }
  }, []);

  const { status, connect, disconnect, subscribe, unsubscribe } = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => setConnected(true),
    onDisconnect: () => setConnected(false),
  });

  useEffect(() => {
    if (taskId) {
      connect();
      return () => {
        unsubscribe(taskId);
        disconnect();
      };
    }
  }, [taskId, connect, disconnect, unsubscribe]);

  useEffect(() => {
    if (taskId && status === 'connected') {
      subscribe(taskId);
    }
  }, [taskId, status, subscribe]);

  return {
    status: statusUpdate?.status,
    progress,
    connected: status === 'connected',
    logs,
    connectionStatus: status,
  };
}
