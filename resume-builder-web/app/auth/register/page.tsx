'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken } from '@/src/lib/api';

export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    if (getAccessToken()) router.replace('/dashboard');
  }, [router]);

  return (
    <main className="grid">
      <section className="card col-12">
        <h2>Create account</h2>
        <p className="small">Account creation is now handled through mobile OTP verification.</p>
        <Link className="btn" href="/auth/login">Continue with Mobile OTP</Link>
      </section>
    </main>
  );
}
