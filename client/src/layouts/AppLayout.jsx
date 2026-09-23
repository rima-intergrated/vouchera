import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/vouchers', label: 'Vouchers' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/customers', label: 'Customers' },
  { to: '/approvals', label: 'Approvals', roles: ['ADMIN'] },
  { to: '/shifts', label: 'Shifts' },
  { to: '/security', label: 'Security', roles: ['ADMIN', 'MANAGER'] },
  { to: '/stores', label: 'Stores' },
  { to: '/users', label: 'Users', roles: ['ADMIN'] },
  { to: '/redemptions', label: 'Redemptions' },
  { to: '/reports', label: 'Reports' },
  { to: '/audit-logs', label: 'Audit Logs' },
  { to: '/settings', label: 'Settings', roles: ['ADMIN'] },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  // Cashiers and customers get the slim mobile shell — no admin sidebar.
  if (user?.role === 'CASHIER' || user?.role === 'CUSTOMER') {
    return (
      <div className="app-shell">
        <header className="topbar">
          <strong>Vouchera</strong>
          <nav>
            <button className="btn secondary" onClick={onLogout}>Logout</button>
          </nav>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    );
  }

  const visibleNav = NAV.filter((item) => !item.roles || item.roles.includes(user?.role ?? ''));
  const cashierVisible = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <div className="admin-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">Vouchera
          <button className="menu-btn" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>☰</button>
        </div>
        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}
            >
              {item.label}
            </NavLink>
          ))}
          {cashierVisible && <NavLink to="/cashier" onClick={() => setMenuOpen(false)} className="sidebar-link">Cashier App</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div className="muted small">{user?.name} · {user?.role}</div>
          <button className="btn secondary" onClick={onLogout}>Logout</button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="topbar">
          <strong>Admin Console</strong>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
