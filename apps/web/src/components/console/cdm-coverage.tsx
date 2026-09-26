"use client";

// omop-data-source-access 7.1 / 7.2 —— CDM 数据产品的覆盖元数据。
//
// 版本与统计都是**该院连接器从库里读出来**的：它说明这家医院自报的 CDM / 词汇表版本
// 与数据分布，不是平台对数据质量的背书——文案必须这么说，不能写成「已验证」。
// 表只显示数量级（上报本来就只有数量级），时间跨度只到月。

export interface CdmCoverage {
  label: string;
  cdmVersion: string | null;
  vocabularyVersion: string | null;
  tables: Array<{ table: string; magnitude: number | null }>;
  timeSpan: { from: string; to: string } | null;
  computedAt: string | null;
  reportedAt: string;
  stale: boolean;
  staleReason: string | null;
}

/** 数据产品声明的 CDM 数据源 label；不是 CDM 产品返回 null。 */
export function cdmSourceLabel(fhirSchema: unknown): string | null {
  const ds = (fhirSchema as { dataSource?: { type?: unknown; label?: unknown } } | null)?.dataSource;
  return ds?.type === "omop-cdm" && typeof ds.label === "string" ? ds.label : null;
}

const MAGNITUDE = ["不足十", "数十", "数百", "数千", "数万", "数十万", "数百万", "数千万", "数亿", "数十亿", "数百亿", "数千亿", "数万亿"];

/** 数量级 k → 「数万」；null = 该表统计失败（不是没有数据）。 */
export function magnitudeText(magnitude: number | null): string {
  if (magnitude === null) return "统计失败";
  return MAGNITUDE[magnitude] ?? `10^${magnitude}`;
}

function magnitudeRange(magnitude: number | null): string | undefined {
  if (magnitude === null) return "该表本次统计超时或出错，不代表没有数据";
  return `${(10 ** magnitude).toLocaleString()} – ${(10 ** (magnitude + 1) - 1).toLocaleString()} 行`;
}

/** DESIGN §6：含时间的日期显示为本地 `YYYY-MM-DD HH:mm`。 */
function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Freshness = "fresh" | "stale" | "pending";

const FRESHNESS: Record<Freshness, { dot: string; color: string; text: string }> = {
  fresh: { dot: "cs-dot-ok", color: "var(--cs-green)", text: "已上报" },
  stale: { dot: "cs-dot-idle", color: "var(--cs-amber)", text: "待刷新" },
  pending: { dot: "cs-dot-off", color: "var(--cs-faint)", text: "待上报" },
};

/** 覆盖元数据新鲜度（DESIGN §2 已登记：静态点，目录属性不 pulse）。 */
export function CoverageFreshnessBadge({ state }: { state: Freshness }) {
  const f = FRESHNESS[state];
  return (
    <span className="cs-chip" style={{ color: f.color, borderColor: f.color }}>
      <span className={`cs-dot ${f.dot}`} />
      {f.text}
    </span>
  );
}

/** CDM 产品的人数规模（person 表数量级）；没有就是「—」，不拿 0 冒充。 */
export function cdmPersonScale(coverage: CdmCoverage | null | undefined): string {
  const person = coverage?.tables.find((t) => t.table === "person");
  if (!person) return "—";
  return person.magnitude === null ? "人数统计失败" : `${magnitudeText(person.magnitude)}人`;
}

export function CdmCoverageSummary({
  label,
  coverage,
}: {
  label: string;
  coverage: CdmCoverage | null | undefined;
}) {
  const state: Freshness = !coverage ? "pending" : coverage.stale ? "stale" : "fresh";
  return (
    <div className="mt-1.5 space-y-1 text-[0.68rem]" style={{ color: "var(--cs-dim)" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="cs-chip cs-mono">OMOP CDM · {label}</span>
        <CoverageFreshnessBadge state={state} />
        {coverage && (
          <span className="cs-mono">
            CDM {coverage.cdmVersion ?? "—"} · 词汇表 {coverage.vocabularyVersion ?? "—"} · 观察期{" "}
            {coverage.timeSpan ? `${coverage.timeSpan.from} 至 ${coverage.timeSpan.to}` : "—"}
          </span>
        )}
      </div>
      {!coverage && <div style={{ color: "var(--cs-faint)" }}>覆盖元数据待该院连接器通过接入校验后上报</div>}
      {coverage && coverage.tables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {coverage.tables.map((t) => (
            <span
              key={t.table}
              className="cs-chip cs-mono tabular-nums"
              title={magnitudeRange(t.magnitude)}
              style={t.magnitude === null ? { color: "var(--cs-amber)", borderColor: "var(--cs-amber)" } : undefined}
            >
              {t.table} {t.magnitude === null ? magnitudeText(null) : `${magnitudeText(t.magnitude)}行`}
            </span>
          ))}
        </div>
      )}
      {coverage?.stale && coverage.staleReason && (
        <div style={{ color: "var(--cs-amber)" }}>{coverage.staleReason}</div>
      )}
      {coverage && (
        <div style={{ color: "var(--cs-faint)" }}>
          版本与统计由该院连接器从院内库读取，属该院自报的事实，不是平台的数据质量背书
          {` · 上报于 ${localDateTime(coverage.reportedAt)}`}
        </div>
      )}
    </div>
  );
}
