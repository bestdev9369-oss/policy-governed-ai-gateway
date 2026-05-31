// ─── Domain enums ─────────────────────────────────────────────────────────────

export type PolicyDecision = 'allow' | 'deny' | 'approval_required';

export type RequestStatus =
  | 'pending'
  | 'allowed'
  | 'denied'
  | 'approval_required'
  | 'approved'
  | 'rejected'
  | 'error';

export type AuditAction =
  | 'request.received'
  | 'policy.evaluated'
  | 'tool.executed'
  | 'tool.skipped'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'cost.recorded';

// ─── Domain entities ──────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  createdAt: Date;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
  description?: string;
  createdAt: Date;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface PolicyRule {
  id: string;
  tenantId: string;
  name: string;
  toolName: string;
  requiredScope?: string;
  maxAmount?: number;
  allowedAgentIds?: string[];
  blockedAgentIds?: string[];
  decision: PolicyDecision;
  reason: string;
  priority: number;
  enabled: boolean;
  createdAt: Date;
}

export interface GatewayRequest {
  id: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  traceId: string;
  status: RequestStatus;
  decision?: PolicyDecision;
  decisionReason?: string;
  matchedPolicyId?: string;
  toolResult?: Record<string, unknown>;
  latencyMs?: number;
  costEstimate?: number;
  tokenCount?: number;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface PolicyDecisionRecord {
  id: string;
  requestId: string;
  tenantId: string;
  policyId?: string;
  decision: PolicyDecision;
  reason: string;
  evaluatedAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  requestId?: string;
  agentId?: string;
  userId?: string;
  action: AuditAction;
  outcome: 'success' | 'failure';
  detail: Record<string, unknown>;
  traceId: string;
  createdAt: Date;
}

export interface Approval {
  id: string;
  requestId: string;
  tenantId: string;
  requestedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  status: 'pending' | 'approved' | 'denied';
  comment?: string;
}

export interface CostEvent {
  id: string;
  requestId: string;
  tenantId: string;
  agentId: string;
  toolName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  recordedAt: Date;
}

// ─── API types ────────────────────────────────────────────────────────────────

export interface GatewayInvokeRequest {
  agentId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  traceId?: string;
}

export interface GatewayInvokeResponse {
  requestId: string;
  traceId: string;
  decision: PolicyDecision;
  status: RequestStatus;
  reason: string;
  toolResult?: Record<string, unknown>;
  costEstimate?: number;
  latencyMs: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
  traceId?: string;
}
