import { MetricsService } from './metrics.service';

describe('MetricsService（Prometheus 文本暴露）', () => {
  it('counter 自增并按标签分成不同序列', () => {
    const metrics = new MetricsService();
    metrics.increment('chat_requests_total', { outcome: 'success' });
    metrics.increment('chat_requests_total', { outcome: 'success' });
    metrics.increment('chat_requests_total', { outcome: 'error' });

    const text = metrics.render();
    expect(text).toContain('# TYPE chat_requests_total counter');
    expect(text).toContain('chat_requests_total{outcome="success"} 2');
    expect(text).toContain('chat_requests_total{outcome="error"} 1');
  });

  it('histogram：桶累积 + _sum/_count（P95 由 Prometheus 侧算）', () => {
    const metrics = new MetricsService();
    metrics.observe('chat_duration_seconds', 0.03);
    metrics.observe('chat_duration_seconds', 3);

    const text = metrics.render();
    expect(text).toContain('# TYPE chat_duration_seconds histogram');
    expect(text).toContain('chat_duration_seconds_bucket{le="0.025"} 0');
    expect(text).toContain('chat_duration_seconds_bucket{le="0.05"} 1');
    expect(text).toContain('chat_duration_seconds_bucket{le="+Inf"} 2');
    expect(text).toContain('chat_duration_seconds_sum 3.03');
    expect(text).toContain('chat_duration_seconds_count 2');
  });

  it('带标签的 histogram：业务标签与 le 共存', () => {
    const metrics = new MetricsService();
    metrics.observe('tool_duration_seconds', 0.2, { tool: 'submit_external_control' });
    const text = metrics.render();
    expect(text).toContain('tool_duration_seconds_bucket{tool="submit_external_control",le="0.25"} 1');
    expect(text).toContain('tool_duration_seconds_count{tool="submit_external_control"} 1');
  });

  it('标签值里的引号与反斜杠被转义（否则暴露格式会被破坏）', () => {
    const metrics = new MetricsService();
    metrics.increment('weird_total', { note: 'say "hi" \\ ok' });
    const text = metrics.render();
    expect(text).toContain('note="say \\"hi\\" \\\\ ok"');
  });

  it('uptime 作为 gauge 暴露，reset 清空计数', () => {
    const metrics = new MetricsService();
    metrics.increment('x_total');
    expect(metrics.render()).toContain('x_total 1');
    metrics.reset();
    expect(metrics.render()).not.toContain('x_total');
    expect(metrics.render()).toMatch(/chat_agent_uptime_seconds \d/);
    // 构造到断言之间可能不足 1ms：只断言非负且有限，不假装它一定 > 0。
    expect(Number.isFinite(metrics.uptimeSeconds())).toBe(true);
    expect(metrics.uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });
});
