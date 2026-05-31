import { useState, useEffect } from 'react';
import { api, type PolicyRow } from '../api/client.js';
import { DecisionBadge } from '../components/DecisionBadge.js';

export function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPolicies()
      .then((r) => setPolicies(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Policy Rules</h2>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>
        Active policies for this tenant. Evaluated in priority order (highest first). Default action: deny.
      </p>
      {loading && <div style={{ color: '#64748b' }}>Loading…</div>}
      {policies.map((p) => (
        <div
          key={p.id}
          style={{
            background: '#1a1d27',
            border: '1px solid #2d3148',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 10,
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 16,
            alignItems: 'start',
            opacity: p.enabled ? 1 : 0.5,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{p.name}</span>
              <DecisionBadge decision={p.decision} />
              {!p.enabled && (
                <span style={{ fontSize: 11, color: '#475569', background: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>
                  DISABLED
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: '#64748b' }}>
              <span>Tool: <span style={{ color: '#7dd3fc', fontFamily: 'monospace' }}>{p.toolName}</span></span>
              {p.requiredScope && <span>Scope: <span style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{p.requiredScope}</span></span>}
              {p.maxAmount && <span>Max: <span style={{ color: '#86efac' }}>${p.maxAmount.toLocaleString()}</span></span>}
              <span>Priority: <span style={{ color: '#94a3b8' }}>{p.priority}</span></span>
            </div>
            <div style={{ marginTop: 8, color: '#475569', fontSize: 12, fontStyle: 'italic' }}>
              {p.reason}
            </div>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#334155' }}>
            {p.id}
          </div>
        </div>
      ))}
      {!loading && policies.length === 0 && (
        <div style={{ color: '#475569', textAlign: 'center', padding: 48 }}>
          No policies defined. Run the seed script.
        </div>
      )}
    </div>
  );
}
