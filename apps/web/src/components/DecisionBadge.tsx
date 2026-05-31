interface Props {
  decision?: string;
  status?: string;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  allowed:          { bg: '#14532d', color: '#22c55e', label: 'Allowed' },
  allow:            { bg: '#14532d', color: '#22c55e', label: 'Allowed' },
  denied:           { bg: '#450a0a', color: '#ef4444', label: 'Denied' },
  deny:             { bg: '#450a0a', color: '#ef4444', label: 'Denied' },
  approval_required:{ bg: '#422006', color: '#eab308', label: 'Approval Required' },
  pending:          { bg: '#1e1b4b', color: '#818cf8', label: 'Pending' },
  approved:         { bg: '#14532d', color: '#22c55e', label: 'Approved' },
  rejected:         { bg: '#450a0a', color: '#ef4444', label: 'Rejected' },
  error:            { bg: '#450a0a', color: '#f87171', label: 'Error' },
};

export function DecisionBadge({ decision, status }: Props) {
  const key = decision ?? status ?? '';
  const style = STATUS_STYLES[key] ?? { bg: '#1e293b', color: '#94a3b8', label: key };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.color}30`,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: style.color,
          flexShrink: 0,
        }}
      />
      {style.label}
    </span>
  );
}
