import { Injectable } from '@nestjs/common';

export type MetricLabels = Record<string, string | number>;

interface CounterPoint {
  name: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramPoint {
  name: string;
  labels: MetricLabels;
  bounds: number[];
  counts: number[];
  sum: number;
  count: number;
}

/** 秒级直方图桶（对话 P95 属 0.1–2s 量级，尾部留到 10s）。 */
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const HELP: Record<string, string> = {
  chat_requests_total: '对话请求数（按结果）',
  chat_duration_seconds: '对话处理耗时（秒）',
  tool_calls_total: '工具调用数（按工具与结果）',
  compliance_decisions_total: '合规闸判定数（按判定与场景）',
  job_submissions_total: '作业提交数（按结果与是否关联合约）',
  compliance_audit_write_total: '合规审计写入控制面审计链的结果',
  contract_auto_offer_total: '合约预授权自动推进的结果（ready/offered/skipped）',
  llm_tokens_total: 'LLM token 消耗（按方向）',
  chat_agent_uptime_seconds: '进程运行时长（秒）',
};

const escapeLabel = (value: string | number): string =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const labelParts = (labels: MetricLabels): string[] =>
  Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeLabel(labels[key])}"`);

/** name{labels} ；无标签时就是裸名字。 */
const seriesName = (name: string, labels: MetricLabels): string => {
  const parts = labelParts(labels);
  return parts.length === 0 ? name : `${name}{${parts.join(',')}}`;
};

/** 追加一个标签的序列名（histogram 的 _bucket 需要额外带 le）。 */
const seriesNameWith = (
  name: string,
  labels: MetricLabels,
  key: string,
  value: string,
): string => {
  const parts = [...labelParts(labels), `${key}="${escapeLabel(value)}"`];
  return `${name}{${parts.join(',')}}`;
};

/**
 * 极小的 Prometheus 指标注册表。
 *
 * 不引 prom-client：需要的只是 counter + histogram 的文本输出，自己写更可控，
 * 也避免为可观测性再添一层依赖。注意这是**进程本地**指标：多实例部署由各自暴露、
 * 由 Prometheus 侧聚合。
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, CounterPoint>();
  private readonly histograms = new Map<string, HistogramPoint>();
  private readonly startedAt = Date.now();

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    const key = seriesName(name, labels);
    const point = this.counters.get(key);
    if (point) {
      point.value += by;
      return;
    }
    this.counters.set(key, { name, labels: { ...labels }, value: by });
  }

  observe(name: string, value: number, labels: MetricLabels = {}, bounds = DEFAULT_BUCKETS): void {
    const key = seriesName(name, labels);
    let point = this.histograms.get(key);
    if (!point) {
      point = {
        name,
        labels: { ...labels },
        bounds: [...bounds],
        counts: new Array(bounds.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, point);
    }
    point.count += 1;
    point.sum += value;
    point.bounds.forEach((bound, index) => {
      if (value <= bound) point!.counts[index] += 1;
    });
  }

  uptimeSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  /** Prometheus 文本暴露格式（version=0.0.4）。 */
  render(): string {
    const lines: string[] = [];

    for (const [name, points] of this.group(this.counters)) {
      if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
      lines.push(`# TYPE ${name} counter`);
      for (const point of points) lines.push(`${seriesName(name, point.labels)} ${point.value}`);
    }

    for (const [name, points] of this.group(this.histograms)) {
      if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const point of points) {
        point.bounds.forEach((bound, index) => {
          lines.push(
            `${seriesNameWith(`${name}_bucket`, point.labels, 'le', String(bound))} ${point.counts[index]}`,
          );
        });
        lines.push(
          `${seriesNameWith(`${name}_bucket`, point.labels, 'le', '+Inf')} ${point.count}`,
        );
        lines.push(`${seriesName(`${name}_sum`, point.labels)} ${point.sum}`);
        lines.push(`${seriesName(`${name}_count`, point.labels)} ${point.count}`);
      }
    }

    if (HELP.chat_agent_uptime_seconds) {
      lines.push(`# HELP chat_agent_uptime_seconds ${HELP.chat_agent_uptime_seconds}`);
    }
    lines.push('# TYPE chat_agent_uptime_seconds gauge');
    lines.push(`chat_agent_uptime_seconds ${this.uptimeSeconds().toFixed(3)}`);

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  /**
   * 按指标名分组。
   *
   * 名字**随点一起存**，不从序列名反推：序列名是渲染结果，反推要靠字符串规则，
   * 一旦规则与渲染漂移就会静默产出空名字（# TYPE 后面空一格），指标等于没暴露。
   */
  private group<T extends { name: string }>(store: Map<string, T>): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const point of store.values()) {
      const list = grouped.get(point.name) ?? [];
      list.push(point);
      grouped.set(point.name, list);
    }
    return grouped;
  }
}
