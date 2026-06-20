'use client';

const HOSPITALS = [
  { id: 'a', label: '医院 A', x: 48 },
  { id: 'b', label: '医院 B', x: 168 },
  { id: 'c', label: '医院 C', x: 288 },
];

export function DataResidencyDiagram({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 220"
      className={`w-full max-w-lg mx-auto ${className}`}
      role="img"
      aria-labelledby="residency-title residency-desc"
    >
      <title id="residency-title">数据不出域示意图</title>
      <desc id="residency-desc">
        原始医疗数据保留在各医院边界内，仅聚合结果经输出门后流出
      </desc>

      <defs>
        <marker id="agg-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#0d9488" />
        </marker>
        <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#f1f5f9" strokeWidth="0.5" />
        </pattern>
      </defs>

      {/* Federation boundary */}
      <rect x="24" y="24" width="352" height="140" rx="12" fill="url(#grid)" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="8 4" />
      <text x="200" y="44" textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="system-ui, sans-serif">
        参与方本地域（数据不出域）
      </text>

      {HOSPITALS.map((h) => (
        <g key={h.id}>
          <rect x={h.x} y="58" width="64" height="88" rx="8" fill="#f0fdfa" stroke="#14b8a6" strokeWidth="1.5" />
          <text x={h.x + 32} y="78" textAnchor="middle" fill="#0f766e" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">
            {h.label}
          </text>
          {/* Raw data blocks - stay inside */}
          <rect x={h.x + 10} y="88" width="44" height="8" rx="2" fill="#5eead4" opacity="0.7" />
          <rect x={h.x + 10} y="100" width="36" height="8" rx="2" fill="#5eead4" opacity="0.5" />
          <rect x={h.x + 10} y="112" width="40" height="8" rx="2" fill="#5eead4" opacity="0.6" />
          <text x={h.x + 32} y="134" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="system-ui, sans-serif">
            原始数据
          </text>
        </g>
      ))}

      {/* Output gate */}
      <rect x="140" y="168" width="120" height="28" rx="6" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.5" />
      <text x="200" y="186" textAnchor="middle" fill="#047857" fontSize="10" fontWeight="500" fontFamily="system-ui, sans-serif">
        输出门 · 聚合放行
      </text>

      {/* Aggregate flow out */}
      <path
        d="M 80 146 Q 80 162 140 182"
        fill="none"
        stroke="#0d9488"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        markerEnd="url(#agg-arrow)"
      />
      <path
        d="M 200 146 L 200 168"
        fill="none"
        stroke="#0d9488"
        strokeWidth="1.5"
        markerEnd="url(#agg-arrow)"
      />
      <path
        d="M 320 146 Q 320 162 260 182"
        fill="none"
        stroke="#0d9488"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        markerEnd="url(#agg-arrow)"
      />

      {/* Only aggregates leave */}
      <rect x="155" y="200" width="90" height="14" rx="3" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1" />
      <text x="200" y="210" textAnchor="middle" fill="#1d4ed8" fontSize="9" fontWeight="500" fontFamily="system-ui, sans-serif">
        仅聚合指标外流
      </text>
    </svg>
  );
}
