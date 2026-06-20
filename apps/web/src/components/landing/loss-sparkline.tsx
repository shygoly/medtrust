'use client';

import { useEffect, useRef, useState } from 'react';

const POINTS = [2.4, 2.1, 1.85, 1.6, 1.35, 1.1, 0.92, 0.78, 0.65, 0.55, 0.48, 0.42];
const W = 280;
const H = 80;
const PAD = 8;

function toPath(visible: number) {
  const n = Math.min(visible, POINTS.length);
  if (n < 2) return '';
  const max = Math.max(...POINTS);
  const min = Math.min(...POINTS);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (POINTS.length - 1);

  return POINTS.slice(0, n)
    .map((v, i) => {
      const x = PAD + i * step;
      const y = PAD + ((v - min) / range) * (H - PAD * 2);
      const sy = H - y;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${sy.toFixed(1)}`;
    })
    .join(' ');
}

export function LossSparkline({ className = '' }: { className?: string }) {
  const [visible, setVisible] = useState(2);
  const frameRef = useRef<number>(0);
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) {
      setVisible(POINTS.length);
      return;
    }

    let i = 2;
    const tick = () => {
      i = (i % POINTS.length) + 1;
      setVisible(i);
      frameRef.current = window.setTimeout(tick, 600);
    };
    frameRef.current = window.setTimeout(tick, 600);
    return () => clearTimeout(frameRef.current);
  }, [reducedMotion]);

  const path = toPath(visible);
  const lastIdx = Math.min(visible, POINTS.length) - 1;
  const max = Math.max(...POINTS);
  const min = Math.min(...POINTS);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (POINTS.length - 1);
  const lx = PAD + lastIdx * step;
  const ly = H - (PAD + ((POINTS[lastIdx] - min) / range) * (H - PAD * 2));

  return (
    <div className={className}>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">CKD 联邦微调 · LoRA Loss（实时流模拟）</span>
          <span className="text-xs font-mono text-blue-600 tabular-nums">
            {POINTS[lastIdx]?.toFixed(2) ?? '—'}
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" role="img" aria-label="Loss 下降曲线">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e2e8f0" strokeWidth="1" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={lx} cy={ly} r="3.5" fill="#2563eb" className="motion-safe:animate-pulse" />
        </svg>
      </div>
    </div>
  );
}
