import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Requests', icon: '⚡' },
  { to: '/audit', label: 'Audit Logs', icon: '📋' },
  { to: '/policies', label: 'Policies', icon: '🛡️' },
  { to: '/demo', label: 'Demo Scenarios', icon: '🎯' },
];

export function Sidebar() {
  return (
    <nav style={{
      width: 220,
      background: '#1a1d27',
      borderRight: '1px solid #2d3148',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #2d3148' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}>
            🛡️
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Policy Gateway</div>
            <div style={{ fontSize: 10, color: '#475569' }}>Control Plane v0.1</div>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <div style={{ padding: '12px 12px', flex: 1 }}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 2,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#a5b4fc' : '#94a3b8',
              background: isActive ? '#312e81' : 'transparent',
              transition: 'all 0.1s',
            })}
          >
            <span>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #2d3148' }}>
        <div style={{ fontSize: 11, color: '#334155' }}>Tenant: Acme Corp</div>
        <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>API: demo-tenant-key-acme</div>
      </div>
    </nav>
  );
}
