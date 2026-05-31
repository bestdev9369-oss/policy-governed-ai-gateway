import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type RequestDetail as DetailData } from '../api/client.js';
import { DecisionBadge } from './DecisionBadge.js';

const LABEL: React.CSSProperties = { color: '#64748b', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const VALUE: React.CSSProperties = { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' };
const CARD: React.CSSProperties = {
  background: '#1a1d27',
  border: '1px solid #2d3148',
  borderRadius: 8,
  padding: '20px 24px',
  marginBottom: 16,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{children}</div>
    </div>
  );
}

export function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api.getRequest(id);
      setData(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const handleApprove = async () => {
    if (!data?.approval) return;
    setActionLoading(true);
    try {
      await api.approveRequest(data.approval.id, 'Approved via dashboard');
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!data?.approval) return;
    setActionLoading(true);
    try {
      await api.denyRequest(data.approval.id, 'Denied via dashboard');
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div style={{ padding: 48, color: '#64748b', textAlign: 'center' }}>Loading…</div>;
  if (error) return <div style={{ padding: 48, color: '#f87171' }}>{error}</div>;
  if (!data) return null;

  const { request: req, policyDecision, approval, costEvent, auditLogs } = data;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>
          ← Back to requests
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Request Detail</h1>
        <DecisionBadge decision={req.decision} status={req.status} />
      </div>

      {/* Approval action */}
      {req.status === 'approval_required' && approval?.status === 'pending' && (
        <div style={{ ...CARD, borderColor: '#78350f', background: '#1c1204' }}>
          <div style={{ color: '#fbbf24', fontWeight: 600, marginBottom: 8 }}>⏳ Awaiting Human Approval</div>
          <div style={{ color: '#d97706', marginBottom: 16, fontSize: 13 }}>
            This request is blocked pending review. Approve or deny below.
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              style={{ padding: '8px 20px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              {actionLoading ? 'Processing…' : '✓ Approve & Execute'}
            </button>
            <button
              onClick={handleDeny}
              disabled={actionLoading}
              style={{ padding: '8px 20px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              ✕ Deny
            </button>
          </div>
        </div>
      )}

      {/* Request metadata */}
      <div style={CARD}>
        <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Gateway Request</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <Field label="Request ID">{req.id}</Field>
          <Field label="Trace ID">{req.traceId}</Field>
          <Field label="Agent">{req.agentName} <span style={{ color: '#475569' }}>({req.agentId})</span></Field>
          <Field label="Tool"><span style={{ color: '#7dd3fc' }}>{req.toolName}</span></Field>
          <Field label="Status"><DecisionBadge status={req.status} /></Field>
          <Field label="Latency">{req.latencyMs != null ? `${req.latencyMs}ms` : '—'}</Field>
          <Field label="Created">{new Date(req.createdAt).toLocaleString()}</Field>
          <Field label="Resolved">{req.resolvedAt ? new Date(req.resolvedAt).toLocaleString() : '—'}</Field>
        </div>
        <Field label="Tool Arguments">
          <pre style={{ background: '#0f1117', padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 12, lineHeight: 1.6 }}>
            {JSON.stringify(req.toolArgs, null, 2)}
          </pre>
        </Field>
        {req.toolResult && (
          <Field label="Tool Result">
            <pre style={{ background: '#0f1117', padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 12, lineHeight: 1.6 }}>
              {JSON.stringify(req.toolResult, null, 2)}
            </pre>
          </Field>
        )}
      </div>

      {/* Policy decision */}
      {policyDecision && (
        <div style={CARD}>
          <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Policy Decision</div>
          <Field label="Decision"><DecisionBadge decision={policyDecision.decision} /></Field>
          <Field label="Reason">{policyDecision.reason}</Field>
          {policyDecision.policyId && <Field label="Matched Policy ID">{policyDecision.policyId}</Field>}
        </div>
      )}

      {/* Cost event */}
      {costEvent && (
        <div style={CARD}>
          <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Cost Event</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            <Field label="Model">{costEvent.model}</Field>
            <Field label="Input Tokens">{costEvent.inputTokens.toLocaleString()}</Field>
            <Field label="Output Tokens">{costEvent.outputTokens.toLocaleString()}</Field>
          </div>
          <Field label="Cost"><span style={{ color: '#86efac', fontSize: 16, fontWeight: 700 }}>${costEvent.costUsd.toFixed(6)} USD</span></Field>
        </div>
      )}

      {/* Audit log */}
      {auditLogs.length > 0 && (
        <div style={CARD}>
          <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Audit Trail</div>
          {auditLogs.map((log) => (
            <div key={log.id} style={{ borderLeft: '2px solid #2d3148', paddingLeft: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: 12 }}>{log.action}</span>
                <span style={{ color: log.outcome === 'success' ? '#22c55e' : '#ef4444', fontSize: 11, fontWeight: 600 }}>
                  {log.outcome.toUpperCase()}
                </span>
                <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 11 }}>
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <pre style={{ background: '#0f1117', padding: 8, borderRadius: 4, fontSize: 11, overflow: 'auto', color: '#94a3b8' }}>
                {JSON.stringify(log.detail, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
