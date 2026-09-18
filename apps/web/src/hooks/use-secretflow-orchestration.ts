'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CKD_PURPOSE, SECRETFLOW_SPEC } from '@medtrust/demo-scenario';
import { api } from '@/api/client';
import { resolveWsBase } from '@/lib/endpoints';

// Shared SecretFlow orchestration logic — single source of truth for the
// preview → 签约 → tasks → WS stream flow. Used by both the manual editor page
// (dashboard/secretflow) and the guided assistant wizard
// (dashboard/secretflow/assistant). Callers own the YAML and pass it in.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021/api/v1';
// 连接时再解析：同源部署需要读 window.location（SSR 阶段没有）。
const wsBase = () =>
  resolveWsBase(API_BASE, process.env.NEXT_PUBLIC_WS_URL, typeof window !== 'undefined' ? window.location : undefined);

const PURPOSE = CKD_PURPOSE;
const BUDGET = { amount: 100, currency: 'CNY' };

// 如实声明节点能力:线上各院 agent 均为 CPU 版 torch、无硬件 TEE → 全部 pyu_only(明文 Python 计算单元)。
// 接入硬件 TEE / 机密 GPU 后应改由节点心跳上报,而非前端写死。
export const DEFAULT_PROFILES = [
  { participantId: 'hospital-huashan', device: 'CPU', hasTee: false },
  { participantId: 'hospital-ruijin', device: 'CPU', hasTee: false },
  { participantId: 'hospital-zhongshan', device: 'CPU', hasTee: false },
  { participantId: 'pharma-demo', device: 'CPU', hasTee: false },
];

export const DEFAULT_SPEC = SECRETFLOW_SPEC;

export type NodePlan = {
  participantId: string;
  tier: string;
  device: string;
  offloadAggregation: boolean;
  localEpochs: number;
  rationale: string;
};
export type LogEvent = {
  phase: string;
  participantId?: string;
  round?: number;
  epoch?: number;
  loss?: number;
  globalLoss?: number;
  state?: string;
  reason?: string;
  result?: any;
};
type Party = { participantId: string; role: string };
export type Settlement = {
  taskRef: string;
  block: number;
  total: number;
  currency: string;
  lines: { org: string; participantId: string; contribution: number; amount: number }[];
};

async function authedPost(path: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = api.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

export function useSecretFlowOrchestration() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [fsmState, setFsmState] = useState('PENDING');
  const [nodePlan, setNodePlan] = useState<NodePlan[]>([]);
  const [transpiled, setTranspiled] = useState('');
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [lossPoints, setLossPoints] = useState<number[]>([]);
  const [result, setResult] = useState<any>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [contractRefs, setContractRefs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => () => wsRef.current?.close(), []);

  const reset = useCallback(() => {
    wsRef.current?.close();
    setEvents([]); setLossPoints([]); setResult(null); setError(null);
    setSettlement(null); setContractRefs([]);
    setFsmState('PENDING'); setTaskId(null);
  }, []);

  const fetchResult = useCallback(async (id: string) => {
    try {
      const [r, s] = await Promise.all([
        fetch(`${API_BASE}/secretflow/tasks/${id}/result`),
        fetch(`${API_BASE}/secretflow/tasks/${id}/settlement`),
      ]);
      if (r.ok) setResult(await r.json());
      if (s.ok) { const sj = await s.json(); if (sj) setSettlement(sj); }
    } catch { /* ignore */ }
  }, []);

  const preview = useCallback(async (yamlText: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/secretflow/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specYaml: yamlText, profiles: DEFAULT_PROFILES }),
      });
      if (!res.ok) throw new Error((await res.json()).message || `HTTP ${res.status}`);
      const data = await res.json();
      setNodePlan(data.nodePlan); setTranspiled(data.transpiledPayload);
    } catch (e: any) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }, []);

  const submit = useCallback(async (yamlText: string) => {
    reset(); setBusy(true);
    try {
      // 1. 预览：拿到解析后的 spec（用于签约）+ 节点计划 + 转译脚本
      const prev = await (await authedPost('/secretflow/preview', { specYaml: yamlText, profiles: DEFAULT_PROFILES })).json();
      if (!prev?.spec) throw new Error(prev?.message || '声明校验失败');
      setNodePlan(prev.nodePlan); setTranspiled(prev.transpiledPayload);

      // 2. 签约：数据提供方为每个 provider 与 consumer 签发数字合约（PEP 准入凭据）
      const parties: Party[] = prev.spec.parties;
      const consumer = parties.find((p) => p.role === 'consumer');
      const providers = parties.filter((p) => p.role === 'provider');
      if (!consumer) throw new Error('spec 缺少 consumer 参与方');
      const contractIds: string[] = [];
      for (const prov of providers) {
        const c = await (await authedPost('/contracts', {
          dataProductId: `dp-${prov.participantId}`, providerId: prov.participantId, consumerId: consumer.participantId,
          purpose: PURPOSE, retention: 'burn-after-read', output: 'aggregate', validDays: 30,
        })).json();
        if (!c?.id) throw new Error(`签约失败（需以数据提供方身份登录）：${c?.message || ''}`);
        contractIds.push(c.id);
      }

      // 3. 下发：PEP 校验合约 → 编排 → 训练
      const res = await authedPost('/secretflow/tasks', {
        specYaml: yamlText, profiles: DEFAULT_PROFILES, contractIds, purpose: PURPOSE, budget: BUDGET,
      });
      if (!res.ok) throw new Error((await res.json()).message || `HTTP ${res.status}`);
      const data = await res.json();
      setTaskId(data.taskId); setFsmState(data.state); setNodePlan(data.nodePlan);
      setContractRefs(data.contractRefs || []);

      const ws = new WebSocket(`${wsBase()}/ws/secretflow?taskId=${data.taskId}`);
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        const e: LogEvent = JSON.parse(msg.data);
        if (e.state) setFsmState(e.state);
        if (e.phase === 'connected') return;
        setEvents((prev2) => [...prev2, e]);
        if (e.phase === 'baseline' && typeof e.globalLoss === 'number') setLossPoints([e.globalLoss]);
        if (e.phase === 'round_complete' && typeof e.globalLoss === 'number')
          setLossPoints((prev2) => [...prev2, e.globalLoss as number]);
        if (e.phase === 'done' || e.phase === 'result') setTimeout(() => fetchResult(data.taskId), 400);
      };
      ws.onerror = () => setError('WebSocket 连接失败（确认 API 在 5021 且 Agent 在 5024 运行）');
    } catch (e: any) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }, [reset, fetchResult]);

  return {
    taskId, fsmState, nodePlan, transpiled, events, lossPoints, result, settlement,
    contractRefs, error, busy, preview, submit, reset,
  };
}

export type SecretFlowOrchestration = ReturnType<typeof useSecretFlowOrchestration>;
