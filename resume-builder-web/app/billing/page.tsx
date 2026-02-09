'use client';

import { useState } from 'react';
import { api } from '@/src/lib/api';

export default function BillingPage() {
  const [message, setMessage] = useState('');

  async function startCheckout(plan: 'STUDENT' | 'PRO') {
    setMessage('');
    try {
      const { url } = await api.checkout(plan);
      window.location.href = url;
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Checkout failed');
    }
  }

  async function openPortal() {
    setMessage('');
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Portal failed');
    }
  }

  return (
    <main className="grid">
      <section className="card col-12">
        <h2>Plans</h2>
        <p className="small">Upgrade to unlock higher limits and faster workflows.</p>
        <div className="grid" style={{ marginTop: 12 }}>
          <div className="card col-4">
            <h3>Free</h3>
            <p className="small">Basic ATS scoring and limited PDF exports.</p>
          </div>
          <div className="card col-4">
            <h3>Student</h3>
            <p className="small">Higher AI limits and more exports for internships.</p>
            <button className="btn" onClick={() => startCheckout('STUDENT')}>Choose Student</button>
          </div>
          <div className="card col-4">
            <h3>Pro</h3>
            <p className="small">High usage limits for active job seekers.</p>
            <button className="btn" onClick={() => startCheckout('PRO')}>Choose Pro</button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn secondary" onClick={openPortal}>Manage Subscription</button>
        </div>
        {message && <p className="small" style={{ marginTop: 12 }}>{message}</p>}
      </section>
    </main>
  );
}
