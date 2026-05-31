/**
 * Lightweight in-process Prometheus-compatible metrics.
 *
 * In production, replace with prom-client or wire to an OpenTelemetry
 * MetricExporter. This implementation deliberately avoids an external
 * dependency so the demo runs with zero infrastructure.
 */

interface Counter {
  labels: Record<string, string>;
  value: number;
}

interface Histogram {
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: Record<number, number>;
}

const HISTOGRAM_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000];

const counters = new Map<string, Counter[]>();
const histograms = new Map<string, Histogram[]>();

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

export const metrics = {
  incCounter(name: string, labels: Record<string, string> = {}) {
    if (!counters.has(name)) counters.set(name, []);
    const series = counters.get(name)!;
    const key = labelKey(labels);
    let entry = series.find((e) => labelKey(e.labels) === key);
    if (!entry) {
      entry = { labels, value: 0 };
      series.push(entry);
    }
    entry.value++;
  },

  observeHistogram(name: string, valueMs: number, labels: Record<string, string> = {}) {
    if (!histograms.has(name)) histograms.set(name, []);
    const series = histograms.get(name)!;
    const key = labelKey(labels);
    let entry = series.find((e) => labelKey(e.labels) === key);
    if (!entry) {
      const buckets: Record<number, number> = {};
      for (const b of HISTOGRAM_BUCKETS) buckets[b] = 0;
      entry = { labels, sum: 0, count: 0, buckets };
      series.push(entry);
    }
    entry.sum += valueMs;
    entry.count++;
    for (const b of HISTOGRAM_BUCKETS) {
      if (valueMs <= b) entry.buckets[b]!++;
    }
  },

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const [name, series] of counters.entries()) {
      lines.push(`# TYPE ${name} counter`);
      for (const { labels, value } of series) {
        const lab = labelKey(labels);
        lines.push(lab ? `${name}{${lab}} ${value}` : `${name} ${value}`);
      }
    }

    for (const [name, series] of histograms.entries()) {
      lines.push(`# TYPE ${name} histogram`);
      for (const { labels, sum, count, buckets } of series) {
        const lab = labelKey(labels);
        const prefix = lab ? `{${lab}}` : '';
        for (const [bucket, cnt] of Object.entries(buckets)) {
          lines.push(`${name}_bucket${prefix.replace('}', `,le="${bucket}"}`)} ${cnt}`);
        }
        lines.push(`${name}_bucket${prefix.replace('}', ',le="+Inf"}')} ${count}`);
        lines.push(`${name}_sum${prefix} ${sum}`);
        lines.push(`${name}_count${prefix} ${count}`);
      }
    }

    return lines.join('\n') + '\n';
  },
};

// Pre-declare metric names used throughout the app
export const METRIC = {
  REQUEST_TOTAL: 'pgag_gateway_requests_total',
  REQUEST_LATENCY_MS: 'pgag_gateway_request_duration_ms',
  POLICY_DECISIONS_TOTAL: 'pgag_policy_decisions_total',
  TOOL_EXECUTIONS_TOTAL: 'pgag_tool_executions_total',
  APPROVAL_PENDING: 'pgag_approvals_pending_total',
  COST_USD_TOTAL: 'pgag_cost_usd_total',
} as const;
