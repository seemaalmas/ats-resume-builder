'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/src/lib/api';

type RouterLike = {
  push: (href: string) => Promise<boolean> | void;
};

const fallbackRouter: RouterLike = {
  push: async () => true,
};

type LoginPageProps = {
  apiClient?: Pick<typeof api, 'requestOtp' | 'verifyOtp' | 'login'>;
  routerOverride?: RouterLike;
};

export default function LoginPage({ apiClient = api, routerOverride }: LoginPageProps = {}) {
  const nextRouter = process.env.NEXT_TEST_MOCK_ROUTER === '1' ? null : useRouter();
  const router = routerOverride ?? nextRouter ?? fallbackRouter;
  const [loginMode, setLoginMode] = useState<'otp' | 'email'>('otp');
  const [otpStep, setOtpStep] = useState<'mobile' | 'code'>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [requestId, setRequestId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  const isDev = process.env.NODE_ENV !== 'production';

  async function handleSendOtp(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setStatus('');
    setSending(true);
    try {
      const response = await apiClient.requestOtp(mobile.trim());
      setRequestId(String(response.requestId || '').trim());
      setDevOtp(response.devOtp || '');
      setStatus(response.devOtp ? 'Using dev OTP helper' : 'OTP sent to your mobile');
      setOtpStep('code');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setVerifying(true);
    try {
      await apiClient.verifyOtp({ phone: mobile.trim(), code: otp.trim(), requestId });
      await router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function handleEmailLogin(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setStatus('');
    setEmailLoading(true);
    try {
      await apiClient.login({ email: email.trim(), password });
      await router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Email login failed');
    } finally {
      setEmailLoading(false);
    }
  }

  const showOtp = loginMode === 'otp';

  return (
    <main className="grid">
      <section className="card col-5">
        <h2>{showOtp ? 'Login with Mobile OTP' : 'Login with Email'}</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {showOtp ? (
            otpStep === 'mobile' ? (
              <form onSubmit={handleSendOtp} style={{ display: 'grid', gap: 12 }}>
                <label className="label" htmlFor="otp-mobile">
                  Mobile number
                </label>
                <input
                  id="otp-mobile"
                  className="input"
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9 +]*"
                  placeholder="+919XXXXXXXXX"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                />
                <button className="btn" type="submit" disabled={sending} aria-busy={sending}>
                  {sending ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} style={{ display: 'grid', gap: 12 }}>
                <label className="label" htmlFor="otp-code">
                  Enter OTP
                </label>
                <input
                  id="otp-code"
                  className="input"
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" type="submit" disabled={verifying} aria-busy={verifying}>
                    {verifying ? 'Verifying...' : 'Verify & Login'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setOtpStep('mobile');
                      setError('');
                      setStatus('');
                    }}
                  >
                    Back
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleEmailLogin} style={{ display: 'grid', gap: 12 }}>
              <label className="label" htmlFor="legacy-email">
                Email
              </label>
              <input
                id="legacy-email"
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <label className="label" htmlFor="legacy-password">
                Password
              </label>
              <input
                id="legacy-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button className="btn" type="submit" disabled={emailLoading} aria-busy={emailLoading}>
                {emailLoading ? 'Signing in...' : 'Login with Email'}
              </button>
            </form>
          )}
          {showOtp && status ? <p className="small">{status}</p> : null}
          {showOtp && devOtp && isDev ? (
            <p className="small">
              Dev OTP <strong>{devOtp}</strong>
            </p>
          ) : null}
          {error ? (
            <div className="message-banner">
              <p className="small">{error}</p>
            </div>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            style={{ justifySelf: 'start' }}
            onClick={() => {
              setError('');
              setStatus('');
              if (showOtp) {
                setLoginMode('email');
              } else {
                setLoginMode('otp');
                setOtpStep('mobile');
              }
            }}
          >
            {showOtp ? 'Use email login (legacy)' : 'Use mobile OTP login'}
          </button>
        </div>
        <p className="small" style={{ marginTop: 12 }}>
          {showOtp
            ? 'New here? Enter your mobile and verify OTP to create your account.'
            : 'Legacy email/password login remains available for existing accounts.'}
        </p>
      </section>
      <section className="card col-7">
        <h3>Why sign in?</h3>
        <p className="small">Save resumes, track ATS scores, and sync across devices.</p>
      </section>
    </main>
  );
}
