"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Gavel } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";
import {
  LAYER_ORDER,
  LAYER_META,
  type CapabilityLayer,
  type CapabilityObject,
} from "@/types/capability.types";
import { isLanded } from "@/lib/capability-landing";

const toKey = (s: string) =>
  s.trim().toLowerCase().replace(/[()]/g, "").replace(/[\s/_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

type AllLayers = Record<CapabilityLayer, CapabilityObject[]>;

function useAtlas() {
  return useQuery({
    queryKey: ["atlas", "all"],
    queryFn: async (): Promise<AllLayers> => {
      const lists = await Promise.all(LAYER_ORDER.map((l) => api.listCapability(l)));
      return Object.fromEntries(LAYER_ORDER.map((l, i) => [l, lists[i]])) as AllLayers;
    },
  });
}

function integrity(all: AllLayers) {
  const keys = (l: CapabilityLayer) => new Set(all[l].flatMap((o) => [toKey(o.key), toKey(o.name)]));
  const algo = keys("l4_algorithm");
  const ops = keys("l5_operator");
  let total = 0;
  let resolved = 0;
  const tally = (refs: string[] | undefined, pool: Set<string>) => {
    for (const r of refs ?? []) {
      total++;
      if (pool.has(toKey(r))) resolved++;
    }
  };
  all.l3_model.forEach((m) => tally(m.trainingAlgorithmKeys, algo));
  all.l4_algorithm.forEach((a) => tally(a.underlyingOperatorKeys, ops));
  return { total, resolved, dangling: total - resolved };
}

function Stratum({ layer, objects, delay }: { layer: CapabilityLayer; objects: CapabilityObject[]; delay: number }) {
  const m = LAYER_META[layer];
  return (
    <Link href={`/space/atlas/${layer}`} className="block at-reveal" style={{ animationDelay: `${delay}ms` }}>
      <div className="at-band px-6 py-5 flex items-center gap-6 overflow-hidden">
        <div className="at-numeral text-6xl shrink-0 w-20 text-center">{m.n}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="at-display text-xl font-semibold">{m.label}</span>
            <span className="at-label">{m.en}</span>
          </div>
          <div className="text-sm mt-0.5" style={{ color: "var(--at-faint)" }}>{m.role}</div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {objects.slice(0, 6).map((o) => <span key={o.key} className="at-key">{o.key}</span>)}
            {objects.length > 6 && <Badge variant="outline" className="at-mono font-normal">+{objects.length - 6}</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="at-display text-3xl font-semibold tabular-nums">{objects.length}</div>
          <div className="at-label">对象 · 已落地 {objects.filter(isLanded).length}</div>
        </div>
        <ArrowRight size={18} className="shrink-0" style={{ color: "var(--at-faint)" }} />
      </div>
    </Link>
  );
}

export default function AtlasOverviewPage() {
  const { data, isLoading, error } = useAtlas();
  const totalObjects = data ? LAYER_ORDER.reduce((n, l) => n + data[l].length, 0) : 0;
  const integ = data ? integrity(data) : null;

  return (
    <div>
      <div className="at-reveal">
        <div className="at-label">SEVEN-LAYER DECOUPLED ARCHITECTURE</div>
        <h1 className="at-display text-5xl font-semibold mt-3 leading-[1.05] max-w-3xl">
          医疗隐私计算<br />七层能力图谱
        </h1>
        <p className="text-base mt-4 max-w-2xl" style={{ color: "var(--at-ink-2)" }}>
          每层是一类同构系统对象的注册表,依赖向下声明为数据;合规层(L2)横向注入约束。
          换任一节点不改一行代码 — 这是"解耦"的全部含义。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-8">
        {[
          { label: "解耦层", value: 7, unit: "层" },
          { label: "系统对象", value: totalObjects, unit: "个" },
          { label: "跨层依赖", value: integ ? `${integ.resolved}/${integ.total}` : "—", unit: integ ? `解析 · ${integ.dangling} 悬空` : "" },
        ].map((s, i) => (
          <Card key={s.label} className="px-5 py-4 at-reveal" style={{ animationDelay: `${100 + i * 60}ms`, background: "var(--at-paper-2)" }}>
            <div className="at-label">{s.label}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="at-display text-3xl font-semibold tabular-nums">{s.value}</span>
              <span className="text-xs" style={{ color: "var(--at-faint)" }}>{s.unit}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-10">
        <div className="at-label mb-4">STRATA · 七层注册表(点击进入单层 CRUD)</div>
        {isLoading && <div className="text-sm" style={{ color: "var(--at-faint)" }}>装载注册表…</div>}
        {error && (
          <Card className="p-5 text-sm" style={{ color: "var(--at-block)", background: "var(--at-paper-2)" }}>
            无法连接控制面 API。请确认后端已启动并已运行 seed。
          </Card>
        )}
        {data && (
          <div className="space-y-3">
            <Stratum layer="l1_scenario" objects={data.l1_scenario} delay={0} />
            <Link href="/space/atlas/compose" className="block at-reveal" style={{ animationDelay: "60ms" }}>
              <div className="at-band px-6 py-5 flex items-center gap-6" data-gov="true">
                <div className="at-numeral text-6xl shrink-0 w-20 text-center" style={{ color: "var(--at-seal)", opacity: 0.22 }}>L2</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <span className="at-display text-xl font-semibold" style={{ color: "var(--at-seal-2)" }}>合规治理</span>
                    <span className="at-label">COMPLIANCE · 通则 + 判例</span>
                  </div>
                  <div className="text-sm mt-0.5" style={{ color: "var(--at-ink-2)" }}>
                    让不让算 / 算完是否合法 — 不执行计算,只读风险与组合,产出裁决约束 L3–L7。
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 gap-1.5" style={{ color: "var(--at-seal-2)", borderColor: "var(--at-seal)" }}>
                  <Gavel size={13} /> 去合规预审
                </Badge>
              </div>
            </Link>
            {LAYER_ORDER.slice(1).map((l, i) => (
              <Stratum key={l} layer={l} objects={data[l]} delay={120 + i * 60} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
