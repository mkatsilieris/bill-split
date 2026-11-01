import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Avatar } from './ui';

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const atHome = location.pathname === '/';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          {atHome ? (
            <Link to="/" className="brand">
              <img src="/icon.svg" alt="" width={28} height={28} />
              <span>Bill Split</span>
            </Link>
          ) : (
            <Link to="/" className="back">
              ‹ Ομάδες
            </Link>
          )}
          <Link to="/profile" className="profile-link" aria-label="Προφίλ">
            {user && <Avatar name={user.name} size={32} />}
          </Link>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
