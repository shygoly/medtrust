// L2 随机效应 Meta 分析森林图（rws-analytics-ladder）。
// 消费后端 DerSimonian–Laird 真结果：每中心 effect(log)+ci95 + 权重，
// 底部合并菱形 + I² 异质性。比值量（OR/HR）用对数 x 轴，参考线在 1。
// 纯 SVG + 主题令牌，无外部依赖；单中心/缺数据安全降级。

export interface ForestEntry {
  siteId: string;
  effect: number; // log scale (log OR / log HR)
  ci95: [number, number]; // log scale
  weightPercent: number;
}

export interface ForestPlotProps {
  forest: ForestEntry[];
  pooledEffect?: number; // log scale
  pooledCi95?: [number, number]; // log scale
  i2Percent?: number;
  /** 比值量标签，默认 OR。 */
  measureLabel?: string;
}

const NICE_TICKS = [0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10, 20];

export function ForestPlot({
  forest,
  pooledEffect,
  pooledCi95,
  i2Percent,
  measureLabel = "OR",
}: ForestPlotProps) {
  if (!forest || forest.length === 0) return null;

  // log(effect) → ratio 单位
  const exp = (v: number) => Math.exp(v);
  const rows = forest.map((f) => ({
    siteId: f.siteId,
    point: exp(f.effect),
    lo: exp(f.ci95[0]),
    hi: exp(f.ci95[1]),
    weight: f.weightPercent,
  }));
  const pooled =
    pooledEffect != null
      ? {
          point: exp(pooledEffect),
          lo: pooledCi95 ? exp(pooledCi95[0]) : exp(pooledEffect),
          hi: pooledCi95 ? exp(pooledCi95[1]) : exp(pooledEffect),
        }
      : null;

  // 对数轴域（含参考线 1 与合并区间），两端各留 8% 边距
  const vals = [
    ...rows.flatMap((r) => [r.lo, r.hi]),
    ...(pooled ? [pooled.lo, pooled.hi] : []),
    1,
  ].filter((v) => v > 0 && Number.isFinite(v));
  const dmin = Math.min(...vals);
  const dmax = Math.max(...vals);
  const lmin = Math.log10(dmin) - 0.08;
  const lmax = Math.log10(dmax) + 0.08;
  const span = lmax - lmin || 1;

  // 布局（viewBox 坐标）
  const W = 640;
  const labelX = 12;
  const plotX0 = 118;
  const plotX1 = 452;
  const numX = 468;
  const rowH = 30;
  const headH = 34;
  const axisH = 30;
  const H = headH + rows.length * rowH + 42 + axisH;
  const pooledY = headH + rows.length * rowH + 20;

  const xOf = (or: number) =>
    plotX0 + ((Math.log10(or) - lmin) / span) * (plotX1 - plotX0);
  const ticks = NICE_TICKS.filter(
    (t) => Math.log10(t) >= lmin && Math.log10(t) <= lmax,
  );
  const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(2));

  const site = "var(--cs-cyan)";
  const line = "var(--cs-line)";
  const text = "var(--cs-text)";
  const dim = "var(--cs-dim)";

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: 680, fontFamily: "inherit" }}
        role="img"
        aria-label="随机效应 Meta 分析森林图"
      >
        {/* 表头 */}
        <text x={labelX} y={20} fontSize={12} fontWeight={600} fill={dim}>
          研究中心
        </text>
        <text x={numX} y={20} fontSize={12} fontWeight={600} fill={dim}>
          {measureLabel}（95% CI）
        </text>
        <text x={W - 10} y={20} fontSize={12} fontWeight={600} fill={dim} textAnchor="end">
          权重
        </text>

        {/* 参考线 OR=1 */}
        <line
          x1={xOf(1)}
          y1={headH - 6}
          x2={xOf(1)}
          y2={pooledY + 12}
          stroke={line}
          strokeDasharray="3 3"
        />

        {/* 每中心行 */}
        {rows.map((r, i) => {
          const y = headH + i * rowH + rowH / 2;
          const side = 7 + (Math.min(100, Math.max(0, r.weight)) / 100) * 13;
          return (
            <g key={r.siteId}>
              <text x={labelX} y={y + 4} fontSize={12.5} fill={text}>
                {r.siteId}
              </text>
              {/* CI 须 */}
              <line x1={xOf(r.lo)} y1={y} x2={xOf(r.hi)} y2={y} stroke={site} strokeWidth={1.5} />
              <line x1={xOf(r.lo)} y1={y - 4} x2={xOf(r.lo)} y2={y + 4} stroke={site} strokeWidth={1.5} />
              <line x1={xOf(r.hi)} y1={y - 4} x2={xOf(r.hi)} y2={y + 4} stroke={site} strokeWidth={1.5} />
              {/* 点估计方块（面积 ∝ 权重） */}
              <rect
                x={xOf(r.point) - side / 2}
                y={y - side / 2}
                width={side}
                height={side}
                fill={site}
              />
              <text x={numX} y={y + 4} fontSize={12} fill={text} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(r.point)} ({fmt(r.lo)}–{fmt(r.hi)})
              </text>
              <text
                x={W - 10}
                y={y + 4}
                fontSize={12}
                fill={dim}
                textAnchor="end"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {r.weight.toFixed(1)}%
              </text>
            </g>
          );
        })}

        {/* 合并菱形 */}
        {pooled && (
          <g>
            <text x={labelX} y={pooledY + 4} fontSize={12.5} fontWeight={700} fill={text}>
              合并
            </text>
            <polygon
              points={`${xOf(pooled.lo)},${pooledY} ${xOf(pooled.point)},${pooledY - 7} ${xOf(pooled.hi)},${pooledY} ${xOf(pooled.point)},${pooledY + 7}`}
              fill="var(--cs-green)"
            />
            <text
              x={numX}
              y={pooledY + 4}
              fontSize={12}
              fontWeight={700}
              fill={text}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmt(pooled.point)} ({fmt(pooled.lo)}–{fmt(pooled.hi)})
            </text>
          </g>
        )}

        {/* 对数轴 */}
        {ticks.map((t) => {
          const yAxis = pooledY + 26;
          return (
            <g key={t}>
              <line x1={xOf(t)} y1={yAxis} x2={xOf(t)} y2={yAxis + 4} stroke={dim} />
              <text x={xOf(t)} y={yAxis + 16} fontSize={11} fill={dim} textAnchor="middle">
                {t >= 1 ? t : t.toString().replace(/^0/, "")}
              </text>
            </g>
          );
        })}
        <line
          x1={plotX0}
          y1={pooledY + 26}
          x2={plotX1}
          y2={pooledY + 26}
          stroke={line}
        />

        {/* I² 徽标 */}
        {i2Percent != null && (
          <text x={plotX0} y={headH - 12} fontSize={11.5} fill={dim}>
            I² = {i2Percent.toFixed(0)}%（中心间异质性）
          </text>
        )}
      </svg>
    </div>
  );
}
