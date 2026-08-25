'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { tokens, logout } from '@/lib/api';

const ALL_LINKS = [
  { href: '/', label: 'Pregled', roles: ['admin', 'editor', 'author'] },
  { href: '/autori', label: 'Autori', roles: ['admin', 'editor', 'author'] },
  { href: '/kategorije', label: 'Kategorije', roles: ['admin', 'editor'] },
  { href: '/tagovi', label: 'Tagovi', roles: ['admin', 'editor'] },
  { href: '/kanali', label: 'Kanali', roles: ['admin', 'editor'] },
  { href: '/clanci', label: 'Članci', roles: ['admin', 'editor', 'author'] },
  { href: '/ab-testovi', label: 'A/B testovi', roles: ['admin', 'editor'] },
  { href: '/alerti', label: 'Alerti', roles: ['admin', 'editor'] },
];

function ThemeToggle() {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    const saved = localStorage.getItem('pulse_theme') ?? 'system';
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function applyTheme(next) {
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
  }

  function cycle() {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    localStorage.setItem('pulse_theme', next);
    applyTheme(next);
  }

  const icon = { system: '◐', light: '☀', dark: '☾' }[theme];

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Tema: ${theme}`}
      className="rounded p-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
    >
      {icon}
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => { setUser(tokens.user); }, []);

  const links = ALL_LINKS.filter((l) => !user || l.roles.includes(user.role));

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-[var(--border)] bg-[var(--surface-1)] md:h-screen md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">Pulse</span>
          <span className="text-xs text-[var(--text-muted)]">tvarenasport</span>
        </Link>
        <ThemeToggle />
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
        {links.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors
                ${active
                ? 'bg-[var(--surface-2)] font-medium text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="truncate text-xs font-medium text-[var(--text-primary)]">{user.name ?? user.email}</div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-xs capitalize text-[var(--text-muted)]">{user.role}</span>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
            >
              Odjava
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

export function PageHeader({ title, description, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{description}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
