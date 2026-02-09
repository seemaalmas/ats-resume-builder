'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getAccessToken } from '@/src/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (getAccessToken()) router.replace('/dashboard');
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      await api.register({ fullName, email, password });
      router.push('/dashboard');
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <main className="grid">
      <section className="card col-5">
        <h2>Create account</h2>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <label className="label">Full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn" type="submit">Create account</button>
        </form>
        <p className="small" style={{ marginTop: 12 }}>{message}</p>
        <p className="small">
          Already have an account? <Link href="/auth/login">Sign in</Link>
        </p>
      </section>
      <section className="card col-7">
        <h3>Student-friendly guidance</h3>
        <p className="small">
          Start with structured prompts and ATS-safe formats tailored for fresher profiles.
        </p>
      </section>
    </main>
  );
}
