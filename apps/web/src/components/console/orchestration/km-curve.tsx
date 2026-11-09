// L3 因果/生存轨道的 Kaplan-Meier 曲线（rws-analytics-ladder 7.3）。
// 消费连接器出域前的分箱结果（`KmCurvePayload`：逐区间 survival + atRisk + suppressed）。
// 被抑制的区间**不连线**（那不是生存率掉到 0，而是该段被高阶闸门抑制），并在下方在险人数表如实标出。
// 纯 SVG + 主题令牌，无外部依赖；缺数据/全抑制时安全降级为提示。

import { kmRiskTable, kmSegments, kmTimeMax, type KmBinLike } from "../../../lib/km-curve";

export interface KmCurveProps {
  bins: readonly KmBinLike[];
  /** 曲线标题里的分组标签（如「接种组 / 未接种组」），缺省不显示。 */
  label?: string;
}

const W = 520;
const H = 180;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

export function KmCurve({ bins, label }: KmCurveProps) {
  const segments = kmSegments(bins);
  const tMax = kmTimeMax(bins) || 1;
  if (segments.length === 0) {
    return (
      <div className="cs-label" style={{ color: "var(--cs-dim)" }}>
        生存曲线：全部分箱因在险人数不足被抑制，无可呈现区间。
      </div>
    );
  }
  const x = (t: number) => PAD.l + (t / tMax) * (W - PAD.l - PAD.r);
  const y = (s: number) => PAD.t + (1 - s) * (H - PAD.t - PAD.b);
  const risk = kmRiskTable(bins);

  return (
    <div>
      <div className="cs-label mb-1">
        Kaplan-Meier 生存曲线{label ? `（${label}）` : ""}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Kaplan-Meier 生存曲线"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((s) => (
          <g key={`y${s}`}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(s)}
              y2={y(s)}
              stroke="var(--cs-line)"
              strokeWidth={0.5}
            />
            <text x={PAD.l - 6} y={y(s) + 3} textAnchor="end" fontSize={9} fill="currentColor">
              {Math.round(s * 100)}%
            </text>
          </g>
        ))}
        {segments.map((seg, i) => {
          // 阶梯：先水平到下一个区间，再垂直落到该区间的 survival
          let d = `M ${x(seg[0].t)} ${y(seg[0].survival)}`;
          for (let k = 1; k < seg.length; k++) {
            d += ` H ${x(seg[k].t)} V ${y(seg[k].survival)}`;
          }
          return (
            <path
              key={`seg${i}`}
              d={d}
              fill="none"
              stroke="var(--cs-cyan)"
              strokeWidth={1.5}
            />
          );
        })}
        <line
          x1={PAD.l}
          y1={H - PAD.b}
          x2={W - PAD.r}
          y2={H - PAD.b}
          stroke="currentColor"
          strokeWidth={0.5}
        />
        <text x={W - PAD.r} y={H - PAD.b + 14} textAnchor="end" fontSize={9} fill="currentColor">
          时间（天，至 {tMax}）
        </text>
      </svg>
      <table className="w-full text-xs mt-1">
        <thead>
          <tr className="cs-label">
            <th className="text-left font-normal">区间（天）</th>
            <th className="text-right font-normal">在险人数</th>
            <th className="text-right font-normal">生存率</th>
          </tr>
        </thead>
        <tbody>
          {risk.map((b) => (
            <tr key={b.t}>
              <td>{b.t}</td>
              <td className="text-right">{b.atRisk}</td>
              <td className="text-right">
                {b.suppressed ? "被抑制" : `${Math.round(b.survival * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs mt-1" style={{ color: "var(--cs-dim)" }}>
        被抑制的区间由高阶统计量闸门（在险人数低于阈值）判定，曲线在该处断开。
      </div>
    </div>
  );
}
