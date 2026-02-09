'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/src/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      await api.login({ email, password });
      router.push('/dashboard');
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid">
      <section className="card col-5">
        <h2>Login</h2>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <label className="label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn" type="submit" disabled={loading} aria-busy={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="small" style={{ marginTop: 12 }}>{message}</p>
        <p className="small">
          New here? <Link href="/auth/register">Create an account</Link>
        </p>
      </section>
      <section className="card col-7">
        <h3>Why sign in?</h3>
        <p className="small">
          Save resumes, track ATS scores, and sync across devices.
        </p>
      </section>
    </main>
  );
}
