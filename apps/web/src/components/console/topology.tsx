// Signature visual: raw data never leaves the hospital connectors (boundary rings);
// only aggregated results flow inward to the control plane. This single graphic is
// the whole thesis of a trusted data space.

const text = (color: string): React.CSSProperties => ({ fill: `var(${color})` });

function ProviderNode({
  x,
  y,
  name,
  rows,
  state = "idle",
}: {
  x: number;
  y: number;
  name: string;
  rows: string;
  state?: "run" | "idle";
}) {
  return (
    <g>
      {/* boundary ring = data stays inside */}
      <circle cx={x} cy={y} r={54} className="cs-boundary" fill="oklch(0.2 0.014 240 / 0.5)"
        stroke="var(--cs-cyan)" strokeWidth={1} />
      {/* node */}
      <circle cx={x} cy={y} r={30} fill="var(--cs-bg-3)" stroke="var(--cs-line)" strokeWidth={1} />
      {/* tiny cross glyph */}
      <g stroke={state === "run" ? "var(--cs-cyan)" : "var(--cs-dim)"} strokeWidth={2.4} strokeLinecap="round">
        <line x1={x} y1={y - 9} x2={x} y2={y + 9} />
        <line x1={x - 9} y1={y} x2={x + 9} y2={y} />
      </g>
      <text x={x} y={y + 76} textAnchor="middle" fontSize={13} style={text("--cs-text")} fontWeight={500}>
        {name}
      </text>
      <text x={x} y={y + 93} textAnchor="middle" fontSize={9.5} className="cs-mono" style={text("--cs-faint")}>
        {rows} · 不出域
      </text>
    </g>
  );
}

export function Topology() {
  return (
    <svg viewBox="0 0 880 480" className="w-full h-auto" role="img"
      aria-label="可信数据空间拓扑:原始数据留在各医院连接器本地,仅聚合结果流向中心控制面">
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
        <line className="cs-flow" x1={208} y1={140} x2={392} y2={210} />
        <line className="cs-flow" x1={208} y1={332} x2={392} y2={262} />
        <line className="cs-flow" x1={672} y1={140} x2={488} y2={210} />
      </g>
      {/* consumer edge (task dispatch / result) */}
      <line x1={672} y1={332} x2={488} y2={262} fill="none" stroke="var(--cs-dim)"
        strokeWidth={1.2} strokeDasharray="4 4" />

      {/* edge labels */}
      <text x={290} y={158} fontSize={9.5} className="cs-mono" style={text("--cs-cyan")}>仅聚合↑</text>
      <text x={290} y={318} fontSize={9.5} className="cs-mono" style={text("--cs-cyan")}>仅聚合↑</text>
      <text x={560} y={158} fontSize={9.5} className="cs-mono" style={text("--cs-cyan")}>仅聚合↑</text>
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

      {/* provider connectors */}
      <ProviderNode x={160} y={115} name="华山医院" rows="184k 行" state="run" />
      <ProviderNode x={160} y={355} name="瑞金医院" rows="151k 行" state="run" />
      <ProviderNode x={720} y={115} name="中山医院" rows="99k 行" />

      {/* consumer connector */}
      <g>
        <circle cx={720} cy={355} r={30} fill="var(--cs-bg-3)" stroke="var(--cs-line)" strokeWidth={1} />
        <text x={720} y={360} textAnchor="middle" fontSize={15} style={text("--cs-amber")}>Rx</text>
        <text x={720} y={355 + 50} textAnchor="middle" fontSize={13} style={text("--cs-text")} fontWeight={500}>创新药企</text>
        <text x={720} y={355 + 67} textAnchor="middle" fontSize={9.5} className="cs-mono" style={text("--cs-faint")}>数据使用方 · 发起方</text>
      </g>
    </svg>
  );
}
