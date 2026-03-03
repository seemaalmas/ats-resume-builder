import type {
  AtsScoreResult,
  DuplicateResumeResult,
  JdParseResult,
  Resume,
  ResumeCritiqueResult,
  ResumeImportResult,
  SkillGapResult,
  User,
} from 'resume-builder-shared';
export type {
  AtsScoreResult,
  DuplicateResumeResult,
  JdParseResult,
  Resume,
  ResumeCritiqueResult,
  ResumeImportResult,
  SkillGapResult,
  User,
} from 'resume-builder-shared';

export type AuthResponse = { user: User; accessToken: string; refreshToken: string; expiresAt?: string };
export type RequestOtpResponse = { requestId: string; devOtp?: string };
export type UploadResumeResponse = ResumeImportResult & {
  text?: string;
  fileName?: string;
  signals?: {
    roleCount: number;
    distinctCompanyCount: number;
    rolesWithDateCount: number;
    roleCompanyPatternCount: number;
    estimatedTotalMonths: number;
  };
  debug?: {
    experienceSignals?: {
      roleCount: number;
      distinctCompanyCount: number;
      rolesWithDateCount: number;
      roleCompanyPatternCount: number;
      estimatedTotalMonths: number;
    };
    sectionHits?: Record<string, number>;
    dateMatches?: string[];
  };
  parsed?: ResumeImportResult;
};

type ResumePayload = {
  title: string;
  contact?: {
    fullName: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: string[];
  };
  summary: string;
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience: {
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }[];
  education: {
    institution: string;
    degree: string;
    startDate: string;
    endDate: string;
    details?: string[];
    gpa?: number | null;
    percentage?: number | null;
  }[];
  projects?: {
    name: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    url?: string;
    highlights: string[];
  }[];
  certifications?: {
    name: string;
    issuer?: string;
    date?: string;
    details?: string[];
  }[];
  templateId?: string;
};

type ResumeUpdatePayload = Partial<ResumePayload>;

type RefreshPayload = { userId: string; refreshToken: string };
type IngestResumeResponse = {
  resume: Resume;
  mapped: ResumeImportResult;
  signals: {
    roleCount: number;
    distinctCompanyCount: number;
    rolesWithDateCount: number;
    roleCompanyPatternCount: number;
    estimatedTotalMonths: number;
  };
};

type CompanySuggestResponse = {
  query: string;
  suggestions: string[];
};

type MetaSuggestResponse = {
  items: string[];
};

export type AdminSettingsResponse = {
  flags: {
    resumeCreationRateLimitEnabled: boolean;
    paymentFeatureEnabled: boolean;
  };
  updatedAt: string | null;
  forcedDisabled: boolean;
};

export type FeatureFlagsResponse = {
  paymentFeatureEnabled: boolean;
};

export type ApiFieldError = {
  path: string;
  message: string;
  suggestions?: string[];
};

export type ApiErrorDetails = {
  status: number;
  code?: string;
  message: string;
  errors: string[];
  fields: ApiFieldError[];
  raw: unknown;
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  errors: string[];
  fields: ApiFieldError[];
  raw: unknown;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = 'ApiRequestError';
    this.status = details.status;
    this.code = details.code;
    this.errors = details.errors;
    this.fields = details.fields;
    this.raw = details.raw;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';
export const RESUME_CREATE_RATE_LIMIT_CODE = 'RESUME_CREATE_RATE_LIMITED';

const storageKeys = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  userId: 'userId',
  userEmail: 'userEmail',
  sessionExpiresAt: 'sessionExpiresAt',
  sessionLastActivityAt: 'sessionLastActivityAt',
};

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REFRESH_GRACE_MS = 2 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 5_000;
let silentRefreshInFlight: Promise<AuthResponse | null> | null = null;
let sessionHeartbeatStarted = false;

export function getAccessToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(storageKeys.accessToken) || '';
}

function getRefreshToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(storageKeys.refreshToken) || '';
}

function getUserId() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(storageKeys.userId) || '';
}

export function getCurrentUserId() {
  return getUserId();
}

export function getCurrentUserEmail() {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(storageKeys.userEmail) || '';
  if (stored) return stored;
  const payload = decodeJwtPayload(getAccessToken());
  const email = typeof payload?.email === 'string' ? payload.email : '';
  if (email) {
    localStorage.setItem(storageKeys.userEmail, email);
  }
  return email;
}

export function getCurrentUserMobile() {
  if (typeof window === 'undefined') return '';
  const payload = decodeJwtPayload(getAccessToken());
  const mobile = typeof payload?.mobile === 'string' ? payload.mobile : '';
  return mobile;
}

export function isCurrentUserAdmin() {
  if (typeof window === 'undefined') return false;
  const adminIds = parseCsvSet(process.env.NEXT_PUBLIC_ADMIN_USER_IDS);
  const adminEmails = parseCsvSet(process.env.NEXT_PUBLIC_ADMIN_EMAILS);
  const adminMobiles = parseMobileSet(process.env.NEXT_PUBLIC_ADMIN_MOBILES);
  const userId = getCurrentUserId().toLowerCase();
  const email = getCurrentUserEmail().toLowerCase();
  if (userId && adminIds.has(userId)) return true;
  if (email && adminEmails.has(email)) return true;
  const mobile = normalizeMobile(getCurrentUserMobile());
  if (mobile && adminMobiles.has(mobile)) return true;
  return false;
}

function setAuthTokens(auth: AuthResponse) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKeys.accessToken, auth.accessToken);
  localStorage.setItem(storageKeys.refreshToken, auth.refreshToken);
  localStorage.setItem(storageKeys.userId, auth.user.id);
  localStorage.setItem(storageKeys.userEmail, auth.user.email);
  persistSessionExpiry(auth);
  markSessionActivity(true);
  notifyAuthStateChanged();
}

function clearAuthTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storageKeys.accessToken);
  localStorage.removeItem(storageKeys.refreshToken);
  localStorage.removeItem(storageKeys.userId);
  localStorage.removeItem(storageKeys.userEmail);
  localStorage.removeItem(storageKeys.sessionExpiresAt);
  localStorage.removeItem(storageKeys.sessionLastActivityAt);
  notifyAuthStateChanged();
}

function notifyAuthStateChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const clean = String(token || '').trim();
  if (!clean) return null;
  const parts = clean.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = window.atob(padded);
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseExpiresAtMs(value?: string | null): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return 0;
  return ms;
}

function getAccessTokenExpiryMs(token?: string): number {
  const payload = decodeJwtPayload(token || getAccessToken());
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return 0;
  return exp * 1000;
}

function persistSessionExpiry(auth: AuthResponse) {
  if (typeof window === 'undefined') return;
  const expiresAtMs = parseExpiresAtMs(auth.expiresAt) || getAccessTokenExpiryMs(auth.accessToken);
  if (!expiresAtMs) return;
  localStorage.setItem(storageKeys.sessionExpiresAt, new Date(expiresAtMs).toISOString());
}

function getSessionExpiryMs(): number {
  if (typeof window === 'undefined') return 0;
  const fromStorage = parseExpiresAtMs(localStorage.getItem(storageKeys.sessionExpiresAt));
  if (fromStorage) return fromStorage;
  const fromToken = getAccessTokenExpiryMs();
  if (fromToken) {
    localStorage.setItem(storageKeys.sessionExpiresAt, new Date(fromToken).toISOString());
  }
  return fromToken;
}

function readIdleTimeoutMs() {
  const raw = String(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MS || '').trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_TIMEOUT_MS;
  return Math.floor(parsed);
}

function markSessionActivity(force = false) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const current = Number(localStorage.getItem(storageKeys.sessionLastActivityAt) || '0');
  if (!force && current > 0 && now - current < ACTIVITY_WRITE_THROTTLE_MS) return;
  localStorage.setItem(storageKeys.sessionLastActivityAt, String(now));
}

function getLastSessionActivityMs() {
  if (typeof window === 'undefined') return 0;
  const value = Number(localStorage.getItem(storageKeys.sessionLastActivityAt) || '0');
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

async function refreshSilently(): Promise<AuthResponse | null> {
  if (typeof window === 'undefined') return null;
  const refreshToken = getRefreshToken();
  const userId = getUserId();
  if (!refreshToken || !userId) {
    clearAuthTokens();
    return null;
  }
  if (!silentRefreshInFlight) {
    silentRefreshInFlight = refresh({ userId, refreshToken }, { silent: true })
      .then((auth) => {
        setAuthTokens(auth);
        return auth;
      })
      .catch(() => {
        clearAuthTokens();
        return null;
      })
      .finally(() => {
        silentRefreshInFlight = null;
      });
  }
  return silentRefreshInFlight;
}

async function ensureSessionActive() {
  if (typeof window === 'undefined') return;
  if (!getAccessToken()) return;

  const idleTimeoutMs = readIdleTimeoutMs();
  const now = Date.now();
  const lastActivityMs = getLastSessionActivityMs();
  if (lastActivityMs > 0 && now - lastActivityMs >= idleTimeoutMs) {
    clearAuthTokens();
    return;
  }
  markSessionActivity(lastActivityMs <= 0);

  const expiryMs = getSessionExpiryMs();
  if (!expiryMs) return;
  if (expiryMs - now > REFRESH_GRACE_MS) return;

  await refreshSilently();
}

export function startSessionHeartbeat() {
  if (typeof window === 'undefined' || sessionHeartbeatStarted) return;
  sessionHeartbeatStarted = true;
  const onActivity = () => {
    markSessionActivity();
  };
  for (const eventName of ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointerdown']) {
    window.addEventListener(eventName, onActivity, { passive: true });
  }
  markSessionActivity(true);
  void ensureSessionActive();
  window.setInterval(() => {
    void ensureSessionActive();
  }, 60_000);
}

function parseCsvSet(raw?: string) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseMobileSet(raw?: string) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((item) => normalizeMobile(item))
      .filter(Boolean),
  );
}

function normalizeMobile(input?: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

type ApiErrorReadOptions = {
  log?: boolean;
};

async function readResponsePayload(res: Response): Promise<unknown> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) return null;

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const shouldParseJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (shouldParseJson) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function logApiError(res: Response, payload: unknown) {
  if (!isDev()) return;
  const details = {
    status: Number.isFinite(res.status) ? res.status : 0,
    url: res.url || '(unknown)',
    payload: payload ?? null,
  };
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[API Error]', details);
  }
}

async function readApiErrorDetails(
  res: Response,
  fallback: string,
  options: ApiErrorReadOptions = {},
): Promise<ApiErrorDetails> {
  const payload = await readResponsePayload(res);
  if (options.log !== false) {
    logApiError(res, payload);
  }

  const details: ApiErrorDetails = {
    status: res.status,
    code: undefined,
    message: fallback,
    errors: [],
    fields: [],
    raw: payload,
  };

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    details.message = trimmed || fallback;
    details.errors = details.message ? [details.message] : [];
    return details;
  }

  if (!payload || typeof payload !== 'object') {
    return details;
  }

  const anyPayload = payload as Record<string, unknown>;
  if (typeof anyPayload.code === 'string' && anyPayload.code.trim()) {
    details.code = anyPayload.code.trim();
  }

  if (Array.isArray(anyPayload.errors)) {
    const messages: string[] = [];
    const fields: ApiFieldError[] = [];
    for (const item of anyPayload.errors) {
      if (typeof item === 'string') {
        const clean = item.trim();
        if (clean) messages.push(clean);
        continue;
      }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const path = typeof obj.path === 'string' ? obj.path : '';
        const message = typeof obj.message === 'string' ? obj.message : '';
        if (path && message) {
          const suggestions = Array.isArray(obj.suggestions)
            ? obj.suggestions.map((entry) => String(entry || '').trim()).filter(Boolean)
            : undefined;
          fields.push({ path, message, suggestions: suggestions && suggestions.length ? suggestions : undefined });
          messages.push(`${path}: ${message}`);
          continue;
        }
        if (message) messages.push(message);
      }
    }
    details.errors = messages;
    details.fields = fields;
  }

  if (Array.isArray(anyPayload.fields)) {
    const fieldItems = (anyPayload.fields as unknown[])
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const path = typeof obj.path === 'string' ? obj.path.trim() : '';
        const message = typeof obj.message === 'string' ? obj.message.trim() : '';
        if (!path || !message) return null;
        const suggestions = Array.isArray(obj.suggestions)
          ? obj.suggestions.map((entry) => String(entry || '').trim()).filter(Boolean)
          : undefined;
        return { path, message, suggestions: suggestions && suggestions.length ? suggestions : undefined };
      })
      .filter(Boolean) as ApiFieldError[];
    if (fieldItems.length) {
      details.fields = fieldItems;
    }
  }

  if (typeof anyPayload.message === 'string' && anyPayload.message.trim()) {
    details.message = anyPayload.message.trim();
  } else if (Array.isArray(anyPayload.message)) {
    const messages = anyPayload.message.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
    if (messages.length) details.message = messages.join(' ');
  } else if (typeof anyPayload.error === 'string' && anyPayload.error.trim()) {
    details.message = anyPayload.error.trim();
  } else if (details.errors.length) {
    details.message = details.errors.join(' ');
  }

  if (!details.errors.length && details.message) {
    details.errors = [details.message];
  }
  return details;
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  await ensureSessionActive();

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
  });

  if (res.status === 401) {
    if (retry) {
      const refreshed = await refreshSilently();
      if (refreshed) {
        return request<T>(path, options, false);
      }
    } else if (getAccessToken()) {
      clearAuthTokens();
    }
  }

  if (!res.ok) throw new ApiRequestError(await readApiErrorDetails(res, 'Request failed'));
  return res.json() as Promise<T>;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  await ensureSessionActive();

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: formData,
    headers: {
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
  });

  if (res.status === 401) {
    const refreshed = await refreshSilently();
    if (refreshed) {
      return upload<T>(path, formData);
    } else if (getAccessToken()) {
      clearAuthTokens();
    }
  }

  if (!res.ok) throw new ApiRequestError(await readApiErrorDetails(res, 'Upload failed'));
  return res.json() as Promise<T>;
}

export async function refresh(payload: RefreshPayload, options: { silent?: boolean } = {}): Promise<AuthResponse> {
  const res = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiRequestError(await readApiErrorDetails(res, 'Refresh failed', { log: !options.silent }));
  return res.json() as Promise<AuthResponse>;
}

export const api = {
  register: async (payload: { fullName: string; email: string; password: string }) => {
    const auth = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthTokens(auth);
    return auth;
  },

  login: async (payload: { email: string; password: string }) => {
    const auth = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthTokens(auth);
    return auth;
  },

  requestOtp: async (phone: string) =>
    request<RequestOtpResponse>('/auth/otp/send', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  verifyOtp: async (payload: { phone: string; code: string; requestId: string }) => {
    const auth = await request<AuthResponse>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthTokens(auth);
    return auth;
  },

  logout: async () => {
    await request('/auth/logout', { method: 'POST' });
    clearAuthTokens();
  },

  getFeatureFlags: () => request<FeatureFlagsResponse>('/settings/public'),

  listResumes: () => request<Resume[]>('/resumes'),

  getResume: (id: string) => request<Resume>(`/resumes/${id}`),

  createResume: (payload: ResumePayload) =>
    request<Resume>('/resumes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateResume: (id: string, payload: ResumeUpdatePayload) =>
    request<Resume>(`/resumes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteResume: (id: string) => request(`/resumes/${id}`, { method: 'DELETE' }),

  duplicateResume: (id: string, title?: string) =>
    request<DuplicateResumeResult>(`/resumes/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  atsScore: (id: string, jdText?: string) =>
    request<AtsScoreResult>(`/resumes/${id}/ats-score`, {
      method: 'POST',
      body: JSON.stringify({ jdText }),
    }),

  uploadResume: (file: File) => {
    const data = new FormData();
    data.append('file', file);
    return upload<UploadResumeResponse>('/resumes/parse-upload', data);
  },

  ingestResume: (id: string, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return upload<IngestResumeResponse>(`/resumes/${id}/ingest`, data);
  },

  recomputeResume: (id: string) =>
    request<{ resumeId: string; roleLevel: 'FRESHER' | 'MID' | 'SENIOR'; signals: Record<string, number> }>(`/resumes/${id}/recompute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  companySuggest: (query: string) =>
    request<CompanySuggestResponse>(`/companies/suggest?q=${encodeURIComponent(query || '')}`),

  suggestInstitutions: (query: string, limit = 10) =>
    request<MetaSuggestResponse>(`/meta/suggest/institutions?q=${encodeURIComponent(query || '')}&limit=${encodeURIComponent(String(limit))}`),

  suggestSkills: (query: string, type: 'technical' | 'soft', limit = 10) =>
    request<MetaSuggestResponse>(`/meta/suggest/skills?q=${encodeURIComponent(query || '')}&type=${encodeURIComponent(type)}&limit=${encodeURIComponent(String(limit))}`),

  suggestCertifications: (query: string, limit = 10) =>
    request<MetaSuggestResponse>(`/meta/suggest/certifications?q=${encodeURIComponent(query || '')}&limit=${encodeURIComponent(String(limit))}`),

  parseJd: (text: string) =>
    request<JdParseResult>(`/ai/parse-jd`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  critique: (resumeText: string, jdText?: string) =>
    request<ResumeCritiqueResult>(`/ai/critique`, {
      method: 'POST',
      body: JSON.stringify({ resumeText, jdText }),
    }),

  skillGap: (resumeText: string, jdText: string) =>
    request<SkillGapResult>(`/ai/skill-gap`, {
      method: 'POST',
      body: JSON.stringify({ resumeText, jdText }),
    }),

  checkout: (plan: 'STUDENT' | 'PRO') =>
    request<{ url: string }>(`/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  portal: () =>
    request<{ url: string }>(`/billing/portal`, {
      method: 'POST',
    }),

  getAdminSettings: () =>
    request<AdminSettingsResponse>('/admin/settings'),

  setResumeCreationRateLimitEnabled: (enabled: boolean) =>
    request<AdminSettingsResponse>('/admin/settings/rate-limit', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  setPaymentFeatureEnabled: (enabled: boolean) =>
    request<AdminSettingsResponse>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ paymentFeatureEnabled: enabled }),
    }),

  downloadPdf: async (id: string, templateId?: string) => {
    const templateQuery = String(templateId || '').trim();
    const requestUrl = templateQuery
      ? `${baseUrl}/resumes/${id}/pdf?templateId=${encodeURIComponent(templateQuery)}`
      : `${baseUrl}/resumes/${id}/pdf`;
    const res = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
    });
    if (!res.ok) throw new ApiRequestError(await readApiErrorDetails(res, 'PDF export failed'));
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `resume-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  },

  getPdfBlob: async (id: string, templateId?: string) => {
    const templateQuery = String(templateId || '').trim();
    const url = templateQuery
      ? `${baseUrl}/resumes/${id}/pdf?templateId=${encodeURIComponent(templateQuery)}`
      : `${baseUrl}/resumes/${id}/pdf`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
    });
    if (!res.ok) throw new ApiRequestError(await readApiErrorDetails(res, 'PDF export failed'));
    return res.blob();
  },
};
