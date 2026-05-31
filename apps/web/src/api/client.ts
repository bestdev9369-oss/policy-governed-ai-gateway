const API_KEY = import.meta.env.VITE_API_KEY ?? 'demo-tenant-key-acme';
const BASE_URL = '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface RequestRow {
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  traceId: string;
  status: string;
  decision?: string;
  decisionReason?: string;
  latencyMs?: number;
  costEstimate?: number;
  tokenCount?: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface RequestDetail {
  request: RequestRow;
  policyDecision: { decision: string; reason: string; policyId?: string } | null;
  approval: { id: string; status: string; comment?: string; resolvedBy?: string } | null;
  costEvent: { costUsd: number; inputTokens: number; outputTokens: number; model: string } | null;
  auditLogs: AuditLogRow[];
}

export interface AuditLogRow {
  id: string;
  action: string;
  outcome: string;
  detail: Record<string, unknown>;
  traceId: string;
  createdAt: string;
}

export interface PolicyRow {
  id: string;
  name: string;
  toolName: string;
  decision: string;
  reason: string;
  requiredScope?: string;
  maxAmount?: number;
  priority: number;
  enabled: boolean;
}

export const api = {
  getRequests: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<{ data: RequestRow[] }>(`/v1/requests${qs}`);
  },

  getRequest: (id: string) =>
    apiFetch<RequestDetail>(`/v1/requests/${id}`),

  getAuditLogs: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<{ data: AuditLogRow[] }>(`/v1/audit-logs${qs}`);
  },

  getPolicies: () =>
    apiFetch<{ data: PolicyRow[] }>('/v1/policies'),

  approveRequest: (approvalId: string, comment?: string) =>
    apiFetch(`/v1/approvals/${approvalId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  denyRequest: (approvalId: string, comment?: string) =>
    apiFetch(`/v1/approvals/${approvalId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),

  invokeGateway: (body: { agentId: string; toolName: string; toolArgs: Record<string, unknown> }) =>
    apiFetch('/v1/gateway/invoke', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getHealth: () =>
    apiFetch<{ status: string }>('/health'),
};
