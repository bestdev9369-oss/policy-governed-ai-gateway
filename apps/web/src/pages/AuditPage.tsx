import { useState, useEffect } from 'react';
import { api, type AuditLogRow } from '../api/client.js';

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditLogs({ pageSize: '100' })
      .then((r) => setLogs(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>Audit Logs</h2>
      {loading && <div style={{ color: '#64748b' }}>Loading…</div>}
      {logs.map((log) => (
        <div
          key={log.id}
          style={{
            background: '#1a1d27',
            border: '1px solid #2d3148',
            borderRadius: 8,
            padding: '14px 20px',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          <div style={{ minWidth: 200 }}>
            <div style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: 12, marginBottom: 4 }}>{log.action}</div>
            <div style={{ fontSize: 11, color: '#475569' }}>{new Date(log.createdAt).toLocaleString()}</div>
          </div>
          <div style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            background: log.outcome === 'success' ? '#14532d' : '#450a0a',
            color: log.outcome === 'success' ? '#22c55e' : '#ef4444',
          }}>
            {log.outcome}
          </div>
          <div style={{ flex: 1 }}>
            <pre style={{ fontSize: 11, color: '#64748b', overflow: 'auto' }}>
              {JSON.stringify(log.detail, null, 2)}
            </pre>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#334155', minWidth: 140 }}>
            {log.traceId.slice(0, 20)}…
          </div>
        </div>
      ))}
      {!loading && logs.length === 0 && (
        <div style={{ color: '#475569', textAlign: 'center', padding: 48 }}>
          No audit logs yet.
        </div>
      )}
    </div>
  );
}
