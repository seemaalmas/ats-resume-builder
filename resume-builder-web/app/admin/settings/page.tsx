'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  getAccessToken,
  isApiRequestError,
  isCurrentUserAdmin,
  type AdminSettingsResponse,
} from '@/src/lib/api';

type Toast = { type: 'success' | 'error'; text: string } | null;

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [forcedDisabled, setForcedDisabled] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!getAccessToken()) {
        if (cancelled) return;
        setHasAccess(false);
        setError('Please sign in to access admin settings.');
        setLoading(false);
        return;
      }
      if (!isCurrentUserAdmin()) {
        if (cancelled) return;
        setHasAccess(false);
        setError('Admin access required.');
        setLoading(false);
        return;
      }
      setHasAccess(true);
      try {
        const current = await api.getAdminSettings();
        if (cancelled) return;
        applySettingsResponse(current);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(getReadableError(err, 'Failed to load admin settings.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusText = useMemo(() => (enabled ? 'Enabled' : 'Disabled'), [enabled]);

  async function onSave() {
    if (!hasAccess) return;
    setSaving(true);
    setError('');
    try {
      const next = await api.setResumeCreationRateLimitEnabled(enabled);
      applySettingsResponse(next);
      setToast({ type: 'success', text: 'Settings saved.' });
    } catch (err: unknown) {
      const message = getReadableError(err, 'Failed to update rate limit setting.');
      setError(message);
      setToast({ type: 'error', text: message });
    } finally {
      setSaving(false);
    }
  }

  function applySettingsResponse(payload: AdminSettingsResponse) {
    setEnabled(Boolean(payload.flags?.resumeCreationRateLimitEnabled));
    setUpdatedAt(payload.updatedAt || null);
    setForcedDisabled(Boolean(payload.forcedDisabled));
  }

  return (
    <main className="grid">
      <section className="card col-7">
        <h2>Admin Settings</h2>
        <p className="small">Control runtime feature flags for backend behavior.</p>
        {loading ? (
          <p className="small">Loading settings...</p>
        ) : null}
        {!loading && !hasAccess ? (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{error || 'Admin access required.'}</p>
          </div>
        ) : null}
        {!loading && hasAccess ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={saving}
              />
              <span>Enable Resume Creation Rate Limit</span>
            </label>
            <p className="small">Current state: <strong>{statusText}</strong></p>
            <p className="small">
              Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : 'Not set'}
            </p>
            {forcedDisabled ? (
              <div className="message-banner">
                <p className="small">`FORCE_DISABLE_RATE_LIMIT=true` is active. Rate limit is currently forced OFF.</p>
              </div>
            ) : null}
            {error ? (
              <div className="message-banner">
                <p className="small">{error}</p>
              </div>
            ) : null}
            <div>
              <button className="btn" onClick={onSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : null}
        {toast ? (
          <div className={`snackbar ${toast.type}`} role="status" aria-live="polite">
            {toast.text}
          </div>
        ) : null}
      </section>
      <section className="card col-5">
        <h3>Rollout Guidance</h3>
        <p className="small">
          Keep this flag disabled in pre-launch/testing. Enable it when rollout starts.
        </p>
        <p className="small">
          For emergencies, set `FORCE_DISABLE_RATE_LIMIT=true` and restart the API to hard-disable it.
        </p>
      </section>
    </main>
  );
}

function getReadableError(error: unknown, fallback: string) {
  if (isApiRequestError(error)) {
    if (error.status === 403) return 'Admin access required.';
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

