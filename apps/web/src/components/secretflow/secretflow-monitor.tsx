'use client';

import type { SecretFlowOrchestration } from '@/hooks/use-secretflow-orchestration';

// Live orchestration monitor — node plan, loss curve, settlement, output,
// event stream, transpiled script. Shared by the manual editor page and the
// guided assistant wizard so there is one rendering of the training view.

const STATE_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700', VALIDATING: 'bg-gray-100 text-gray-700',
  PLANNING: 'bg-indigo-100 text-indigo-700', DISPATCHING: 'bg-indigo-100 text-indigo-700',
  TRAINING: 'bg-blue-100 text-blue-700', AGGREGATING: 'bg-blue-100 text-blue-700',
  COMPENSATING: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

function LossCurve({ points }: { points: number[] }) {
  if (points.length === 0) return <div className="text-sm text-gray-400">等待训练数据…</div>;
  const w = 480, h = 160, pad = 24;
  const max = Math.max(...points, 0.01);
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - 2 * pad);
    const y = h - pad - (p / max) * (h - 2 * pad);
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xl border border-gray-100 rounded bg-white">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#e5e7eb" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#e5e7eb" />
      <polyline points={coords.join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} />
      {points.map((p, i) => {
        const [x, y] = coords[i].split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r={3} fill="#2563eb" />;
      })}
      <text x={pad} y={pad - 6} className="fill-gray-400" fontSize={10}>loss</text>
    </svg>
  );
}

export function SecretFlowMonitor({ o }: { o: SecretFlowOrchestration }) {
  const { fsmState, taskId, nodePlan, lossPoints, settlement, contractRefs, result, events, transpiled } = o;
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">状态</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[fsmState] || 'bg-gray-100 text-gray-700'}`}>{fsmState}</span>
          {taskId && <span className="text-xs text-gray-400 font-mono">{taskId}</span>}
        </div>

        {nodePlan.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">异构节点计划</h3>
            <div className="space-y-1">
              {nodePlan.map((n) => (
                <div key={n.participantId} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-700 w-24">{n.participantId}</span>
                  <span className={`px-2 py-0.5 rounded ${n.tier === 'teeu_full' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{n.tier}</span>
                  <span className="text-gray-500">{n.device}</span>
                  {n.offloadAggregation && <span className="text-gray-400">· 卸载聚合</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">训练 Loss 曲线（全局）</h3>
          <LossCurve points={lossPoints} />
        </div>
      </div>

      {settlement && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-green-800 mb-2">商业闭环 · 按贡献分账</h3>
          <table className="text-xs w-full max-w-md">
            <thead><tr className="text-gray-500 text-left"><th className="py-1">提供方</th><th>贡献度</th><th>收益</th></tr></thead>
            <tbody>
              {settlement.lines.map((l) => (
                <tr key={l.participantId} className="border-t border-green-100">
                  <td className="py-1 font-mono">{l.org}</td>
                  <td>{l.contribution}%</td>
                  <td className="text-green-700">{l.amount} {settlement.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-gray-500">
            链上存证 block #{settlement.block} · taskRef <span className="font-mono">{settlement.taskRef}</span>
          </div>
          {contractRefs.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">合约哈希：<span className="font-mono">{contractRefs.join(', ')}</span></div>
          )}
        </div>
      )}

      {result && (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">安全输出（output-gated）</h3>
          <pre className="text-xs font-mono text-gray-600 overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      {events.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">事件流</h3>
          <div className="bg-white border border-gray-200 rounded-md max-h-56 overflow-y-auto text-xs font-mono">
            {events.map((e, i) => (
              <div key={i} className="px-3 py-1 border-b border-gray-50 flex gap-3">
                <span className="text-blue-600 w-28">{e.phase}</span>
                {e.participantId && <span className="text-gray-500">{e.participantId}</span>}
                {typeof e.loss === 'number' && <span className="text-gray-700">loss={e.loss.toFixed(4)}</span>}
                {typeof e.globalLoss === 'number' && <span className="text-gray-700">global={e.globalLoss.toFixed(4)}</span>}
                {e.reason && <span className="text-amber-600">{e.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {transpiled && (
        <details className="bg-gray-900 text-gray-100 rounded-md p-4">
          <summary className="cursor-pointer text-sm">转译后的 SecretFlow/Ray 脚本（{transpiled.split('\n').length} 行）</summary>
          <pre className="mt-2 text-xs font-mono overflow-x-auto">{transpiled}</pre>
        </details>
      )}
    </div>
  );
}
