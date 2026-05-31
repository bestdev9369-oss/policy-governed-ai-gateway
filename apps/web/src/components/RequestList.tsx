import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, type RequestRow } from '../api/client.js';
import { DecisionBadge } from './DecisionBadge.js';

const CELL: React.CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid #2d3148',
  fontSize: 13,
  verticalAlign: 'middle',
};

const HEADER_CELL: React.CSSProperties = {
  ...CELL,
  color: '#64748b',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  background: '#1a1d27',
  borderBottom: '1px solid #2d3148',
};

export function RequestList() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { pageSize: '50' };
      if (filter) params['status'] = filter;
      const res = await api.getRequests(params);
      setRequests(res.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 5 s
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, padding: '16px 24px', borderBottom: '1px solid #2d3148', background: '#1a1d27', alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontSize: 13, marginRight: 8 }}>Filter:</span>
        {['', 'allowed', 'denied', 'approval_required', 'pending'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid',
              borderColor: filter === s ? '#6366f1' : '#2d3148',
              background: filter === s ? '#312e81' : 'transparent',
              color: filter === s ? '#a5b4fc' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 12 }}>
          {loading ? 'Refreshing…' : `${requests.length} records · auto-refresh 5s`}
        </span>
      </div>

      {error && (
        <div style={{ padding: 24, color: '#f87171', background: '#450a0a22', borderBottom: '1px solid #450a0a' }}>
          {error}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Time', 'Agent', 'Tool', 'Decision', 'Latency', 'Cost (USD)', 'Trace ID', ''].map((h) => (
              <th key={h} style={HEADER_CELL}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && !loading && (
            <tr>
              <td colSpan={8} style={{ ...CELL, textAlign: 'center', color: '#475569', padding: 48 }}>
                No requests yet. Invoke the gateway to see activity.
              </td>
            </tr>
          )}
          {requests.map((r) => (
            <tr
              key={r.id}
              style={{ background: '#0f1117', transition: 'background 0.1s' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = '#1a1d27')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = '#0f1117')}
            >
              <td style={CELL}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              </td>
              <td style={CELL}>
                <span style={{ fontFamily: 'monospace', color: '#a5b4fc' }}>{r.agentName}</span>
              </td>
              <td style={CELL}>
                <span style={{ fontFamily: 'monospace', color: '#7dd3fc', fontSize: 12 }}>{r.toolName}</span>
              </td>
              <td style={CELL}>
                <DecisionBadge decision={r.decision} status={r.status} />
              </td>
              <td style={CELL}>
                <span style={{ color: r.latencyMs && r.latencyMs > 500 ? '#f87171' : '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>
                  {r.latencyMs != null ? `${r.latencyMs}ms` : '—'}
                </span>
              </td>
              <td style={CELL}>
                <span style={{ color: '#86efac', fontFamily: 'monospace', fontSize: 12 }}>
                  {r.costEstimate != null ? `$${r.costEstimate.toFixed(6)}` : '—'}
                </span>
              </td>
              <td style={CELL}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#475569' }} title={r.traceId}>
                  {r.traceId.slice(0, 16)}…
                </span>
              </td>
              <td style={CELL}>
                <Link
                  to={`/requests/${r.id}`}
                  style={{ color: '#6366f1', fontSize: 12, textDecoration: 'none', fontWeight: 500 }}
                >
                  Details →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
