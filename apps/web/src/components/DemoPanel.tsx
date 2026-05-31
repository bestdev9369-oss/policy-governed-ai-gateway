import { useState } from 'react';
import { api } from '../api/client.js';

const SCENARIOS = [
  {
    label: '✅ Scenario 1 — Allowed',
    description: 'SalesBot calls lookup_customer. Policy allows: agent has crm:read scope.',
    body: { agentId: 'agent-sales-001', toolName: 'lookup_customer', toolArgs: { customer_id: 'cust-42' } },
    color: '#15803d',
  },
  {
    label: '🚫 Scenario 2 — Denied',
    description: 'FinanceBot tries wire_transfer. Policy denies: agent lacks finance:write scope.',
    body: { agentId: 'agent-finance-001', toolName: 'wire_transfer', toolArgs: { amount: 5000, account: 'ACC-999' } },
    color: '#b91c1c',
  },
  {
    label: '⏳ Scenario 3 — Approval Required',
    description: 'MarketingBot calls send_email. Policy requires human approval before delivery.',
    body: { agentId: 'agent-marketing-001', toolName: 'send_email', toolArgs: { to: 'vip@acme.com', subject: 'Q2 Promotion', body: 'Hi there!' } },
    color: '#92400e',
  },
];

interface Result {
  status: number;
  body: unknown;
}

export function DemoPanel() {
  const [results, setResults] = useState<Record<number, Result | 'loading'>>({});

  const run = async (index: number) => {
    const scenario = SCENARIOS[index];
    if (!scenario) return;
    setResults((r) => ({ ...r, [index]: 'loading' }));
    try {
      const body = await api.invokeGateway(scenario.body);
      setResults((r) => ({ ...r, [index]: { status: 200, body } }));
    } catch (e) {
      setResults((r) => ({ ...r, [index]: { status: 0, body: { error: String(e) } } }));
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>Demo Scenarios</h2>
      <p style={{ color: '#64748b', marginBottom: 24, fontSize: 13 }}>
        Fire the three canonical gateway flows. Results appear in the request list above.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {SCENARIOS.map((s, i) => (
          <div
            key={i}
            style={{
              background: '#1a1d27',
              border: `1px solid ${s.color}55`,
              borderRadius: 10,
              padding: 20,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#f1f5f9', fontSize: 15 }}>{s.label}</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>{s.description}</div>
            <button
              onClick={() => run(i)}
              disabled={results[i] === 'loading'}
              style={{
                width: '100%',
                padding: '8px 0',
                background: s.color,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {results[i] === 'loading' ? 'Running…' : 'Run Scenario'}
            </button>
            {results[i] && results[i] !== 'loading' && (
              <pre style={{
                background: '#0f1117',
                padding: 10,
                borderRadius: 6,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 160,
                color: '#94a3b8',
                lineHeight: 1.5,
              }}>
                {JSON.stringify(results[i] as Result, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
