'use client';

import { useState, useCallback, useEffect } from 'react';
import { flowerApi } from '@/api/flower.api';
import type { FlowerServer, FlowerHealthStatus } from '@/types/flower.types';

interface UseFlowerServersOptions {
  autoFetch?: boolean;
  pollInterval?: number;
}

export function useFlowerServers(options: UseFlowerServersOptions = {}) {
  const { autoFetch = true, pollInterval } = options;

  const [servers, setServers] = useState<FlowerServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await flowerApi.getServers();
      setServers(data);
    } catch (err: any) {
      setError(err.message || '获取 Flower 服务器列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      fetchServers();

      if (pollInterval) {
        const interval = setInterval(fetchServers, pollInterval);
        return () => clearInterval(interval);
      }
    }
  }, [autoFetch, fetchServers, pollInterval]);

  return {
    servers,
    loading,
    error,
    fetchServers,
  };
}

// Hook for a single server's health
export function useFlowerServerHealth(serverId: string | undefined, options: UseFlowerServersOptions = {}) {
  const { autoFetch = true, pollInterval = 30000 } = options;

  const [health, setHealth] = useState<FlowerHealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!serverId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await flowerApi.getHealth(serverId);
      setHealth(data);
    } catch (err: any) {
      setError(err.message || '获取服务器健康状态失败');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (autoFetch && serverId) {
      fetchHealth();

      if (pollInterval) {
        const interval = setInterval(fetchHealth, pollInterval);
        return () => clearInterval(interval);
      }
    }
  }, [autoFetch, serverId, fetchHealth, pollInterval]);

  return {
    health,
    loading,
    error,
    fetchHealth,
  };
}
