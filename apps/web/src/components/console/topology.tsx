// Signature visual: raw data never leaves the hospital connectors (boundary rings);
// only aggregated results flow inward to the control plane. This single graphic is
// the whole thesis of a trusted data space.
//
// 节点来自真实的连接器注册表（调用方传入），图里不写死任何机构名或数据量。

const text = (color: string): React.CSSProperties => ({ fill: `var(${color})` });

export interface TopologyProvider {
  name: string;
  /** 节点下方的状态说明，如「在线」「离线」。 */
  note: string;
  state: "run" | "idle";
}

/** 图上的三个提供方槽位：节点坐标、汇入控制面的聚合流线、流线标注位置。 */
const SLOTS = [
  { x: 160, y: 115, edge: [208, 140, 392, 210], label: [290, 158] },
  { x: 160, y: 355, edge: [208, 332, 392, 262], label: [290, 318] },
  { x: 720, y: 115, edge: [672, 140, 488, 210], label: [560, 158] },
] as const;

export const TOPOLOGY_PROVIDER_SLOTS = SLOTS.length;

function ProviderNode({ x, y, provider }: { x: number; y: number; provider: TopologyProvider }) {
  return (
    <g>
      {/* boundary ring = data stays inside */}
      <circle cx={x} cy={y} r={54} className="cs-boundary" fill="oklch(0.2 0.014 240 / 0.5)"
        stroke="var(--cs-cyan)" strokeWidth={1} />
      {/* node */}
      <circle cx={x} cy={y} r={30} fill="var(--cs-bg-3)" stroke="var(--cs-line)" strokeWidth={1} />
      {/* tiny cross glyph */}
      <g stroke={provider.state === "run" ? "var(--cs-cyan)" : "var(--cs-dim)"} strokeWidth={2.4} strokeLinecap="round">
        <line x1={x} y1={y - 9} x2={x} y2={y + 9} />
        <line x1={x - 9} y1={y} x2={x + 9} y2={y} />
      </g>
      <text x={x} y={y + 76} textAnchor="middle" fontSize={13} style={text("--cs-text")} fontWeight={500}>
        {provider.name}
      </text>
      <text x={x} y={y + 93} textAnchor="middle" fontSize={9.5} className="cs-mono" style={text("--cs-faint")}>
        {provider.note} · 不出域
      </text>
    </g>
  );
}

export function Topology({ providers }: { providers: TopologyProvider[] }) {
  const shown = providers.slice(0, SLOTS.length);
  return (
    <svg viewBox="0 0 880 480" className="w-full h-auto" role="img"
      aria-label="可信数据空间拓扑:原始数据留在各参与方连接器本地,仅聚合结果流向中心控制面">
      <defs>
        <marker id="cs-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0,0 L8,4.5 L0,9 Z" fill="var(--cs-cyan)" />
        </marker>
        <radialGradient id="cs-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.82 0.13 195 / 0.35)" />
          <stop offset="100%" stopColor="oklch(0.82 0.13 195 / 0)" />
        </radialGradient>
      </defs>

      {/* aggregate-flow edges (provider -> center) */}
      <g fill="none" stroke="var(--cs-cyan)" strokeWidth={1.4} markerEnd="url(#cs-arrow)">
        {shown.map((_, i) => {
          const [x1, y1, x2, y2] = SLOTS[i].edge;
          return <line key={i} className="cs-flow" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      {/* consumer edge (task dispatch / result) */}
      <line x1={672} y1={332} x2={488} y2={262} fill="none" stroke="var(--cs-dim)"
        strokeWidth={1.2} strokeDasharray="4 4" />

      {/* edge labels */}
      {shown.map((_, i) => (
        <text key={i} x={SLOTS[i].label[0]} y={SLOTS[i].label[1]} fontSize={9.5} className="cs-mono"
          style={text("--cs-cyan")}>
          仅聚合↑
        </text>
      ))}
      <text x={548} y={318} fontSize={9.5} className="cs-mono" style={text("--cs-faint")}>任务↓ 结果↑</text>

      {/* center: control plane */}
      <circle cx={440} cy={235} r={80} fill="url(#cs-core)" />
      <g>
        <polygon
          points="440,193 482,235 440,277 398,235"
          fill="var(--cs-bg-3)"
          stroke="var(--cs-cyan)"
          strokeWidth={1.5}
          className="cs-glow-cyan"
        />
        <text x={440} y={231} textAnchor="middle" fontSize={12.5} style={text("--cs-text")} fontWeight={600}>
          可信控制面
        </text>
        <text x={440} y={248} textAnchor="middle" fontSize={8.5} className="cs-mono" style={text("--cs-faint")}>
          目录·身份·合约·存证
        </text>
      </g>

      {/* provider connectors (real registry rows) */}
      {shown.map((p, i) => (
        <ProviderNode key={i} x={SLOTS[i].x} y={SLOTS[i].y} provider={p} />
      ))}

      {/* consumer side (schematic role, not a named party) */}
      <g>
        <circle cx={720} cy={355} r={30} fill="var(--cs-bg-3)" stroke="var(--cs-line)" strokeWidth={1} />
        <text x={720} y={360} textAnchor="middle" fontSize={15} style={text("--cs-amber")}>Rx</text>
        <text x={720} y={355 + 50} textAnchor="middle" fontSize={13} style={text("--cs-text")} fontWeight={500}>数据使用方</text>
        <text x={720} y={355 + 67} textAnchor="middle" fontSize={9.5} className="cs-mono" style={text("--cs-faint")}>任务发起方</text>
      </g>
    </svg>
  );
}
