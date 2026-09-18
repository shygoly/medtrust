'use client';

const NODES = [
  {
    id: 'orchestration',
    label: '编排闭环',
    sub: '声明 · 回传 · 补偿',
    cx: 200,
    cy: 72,
    fill: '#dbeafe',
    stroke: '#2563eb',
    text: '#1d4ed8',
  },
  {
    id: 'data',
    label: '数据闭环',
    sub: '不出域 · 去标识 · 输出门',
    cx: 72,
    cy: 248,
    fill: '#ccfbf1',
    stroke: '#0d9488',
    text: '#0f766e',
  },
  {
    id: 'commercial',
    label: '商业闭环',
    sub: '挂牌 · 分账 · 存证',
    cx: 328,
    cy: 248,
    fill: '#ede9fe',
    stroke: '#7c3aed',
    text: '#6d28d9',
  },
] as const;

const EDGES = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 0 },
];

function edgePath(fromIdx: number, toIdx: number) {
  const from = NODES[fromIdx];
  const to = NODES[toIdx];
  const mx = (from.cx + to.cx) / 2;
  const my = (from.cy + to.cy) / 2;
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * 28;
  const oy = (dx / len) * 28;
  return `M ${from.cx} ${from.cy} Q ${mx + ox} ${my + oy} ${to.cx} ${to.cy}`;
}

export function ClosureLoop({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 320"
      className={`w-full max-w-md mx-auto ${className}`}
      role="img"
      aria-labelledby="closure-loop-title closure-loop-desc"
    >
      <title id="closure-loop-title">MedTrust 三闭环架构</title>
      <desc id="closure-loop-desc">
        编排闭环、数据闭环与商业闭环三条流相互衔接，运行在合规护栏内，构成医疗可信数据空间的核心机制
      </desc>

      <defs>
        <marker
          id="closure-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="#64748b" />
        </marker>
        <filter id="closure-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
        </filter>
      </defs>

      {/* Compliance guardrail — the boundary all three loops run inside */}
      <circle cx="200" cy="168" r="124" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="6 4" />

      {EDGES.map(({ from, to }, i) => (
        <path
          key={i}
          d={edgePath(from, to)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          markerEnd="url(#closure-arrow)"
          className="motion-safe:animate-pulse"
          style={{ animationDuration: '3s', animationDelay: `${i * 0.4}s` }}
        />
      ))}

      {NODES.map((node) => (
        <g key={node.id} filter="url(#closure-shadow)">
          <circle cx={node.cx} cy={node.cy} r="52" fill={node.fill} stroke={node.stroke} strokeWidth="2.5" />
          <text
            x={node.cx}
            y={node.cy - 6}
            textAnchor="middle"
            fill={node.text}
            fontSize="13"
            fontWeight="600"
            fontFamily="system-ui, sans-serif"
          >
            {node.label}
          </text>
          <text
            x={node.cx}
            y={node.cy + 14}
            textAnchor="middle"
            fill="#64748b"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
          >
            {node.sub}
          </text>
        </g>
      ))}

      <text x="200" y="162" textAnchor="middle" fill="#334155" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">
        可信数据空间
      </text>
      <text x="200" y="180" textAnchor="middle" fill="#b45309" fontSize="9" fontWeight="500" fontFamily="system-ui, sans-serif">
        · 合规护栏内 ·
      </text>
    </svg>
  );
}
