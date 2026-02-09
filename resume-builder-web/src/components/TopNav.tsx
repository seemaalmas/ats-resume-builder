'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getAccessToken } from '@/src/lib/api';

export default function TopNav() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const update = () => setAuthed(Boolean(getAccessToken()));
    update();
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  async function onLogout() {
    try {
      await api.logout();
    } finally {
      setAuthed(false);
      router.push('/auth/login');
    }
  }

  return (
    <nav className="nav">
      <Link href="/">Home</Link>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/billing">Billing</Link>
      {authed ? (
        <button className="btn secondary" type="button" onClick={onLogout}>Logout</button>
      ) : (
        <Link href="/auth/login">Login</Link>
      )}
    </nav>
  );
}
