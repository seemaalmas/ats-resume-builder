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

export type AuthResponse = { user: User; accessToken: string; refreshToken: string };
export type UploadResumeResponse = ResumeImportResult & {
  text?: string;
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
    details: string[];
  }[];
  projects?: {
    name: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    highlights: string[];
  }[];
  certifications?: {
    name: string;
    issuer?: string;
    date?: string;
    details?: string[];
  }[];
};

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

const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const storageKeys = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  userId: 'userId',
};

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

function setAuthTokens(auth: AuthResponse) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKeys.accessToken, auth.accessToken);
  localStorage.setItem(storageKeys.refreshToken, auth.refreshToken);
  localStorage.setItem(storageKeys.userId, auth.user.id);
}

function clearAuthTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storageKeys.accessToken);
  localStorage.removeItem(storageKeys.refreshToken);
  localStorage.removeItem(storageKeys.userId);
}

function isDev() {
  return process.env.NODE_ENV !== 'production';
}

async function readApiError(res: Response, fallback: string) {
  const contentType = res.headers.get('content-type') || '';
  let payload: unknown = null;
  try {
    if (contentType.includes('application/json')) {
      payload = await res.json();
    } else {
      const text = await res.text();
      payload = text ? JSON.parse(text) : null;
    }
  } catch {
    try {
      const text = await res.text();
      payload = text;
    } catch {
      payload = null;
    }
  }

  if (isDev()) {
    console.error('[API Error]', { status: res.status, url: res.url, payload });
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || fallback;
  }
  if (payload && typeof payload === 'object') {
    const anyPayload = payload as Record<string, unknown>;
    if (Array.isArray(anyPayload.errors) && anyPayload.errors.length) {
      const normalizedErrors = anyPayload.errors
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            const message = typeof obj.message === 'string' ? obj.message : '';
            const path = typeof obj.path === 'string' ? obj.path : '';
            if (message && path) return `${path}: ${message}`;
            return message;
          }
          return '';
        })
        .filter(Boolean)
        .join(' ');
      if (normalizedErrors) return normalizedErrors;
    }
    if (Array.isArray(anyPayload.message)) {
      return anyPayload.message.filter((item) => typeof item === 'string').join(' ');
    }
    if (typeof anyPayload.message === 'string') {
      return anyPayload.message;
    }
    if (typeof anyPayload.error === 'string') {
      return anyPayload.error;
    }
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
  });

  if (res.status === 401 && retry && getRefreshToken() && getUserId()) {
    try {
      const refreshed = await refresh({ userId: getUserId(), refreshToken: getRefreshToken() });
      setAuthTokens(refreshed);
      return request<T>(path, options, false);
    } catch {
      clearAuthTokens();
    }
  }

  if (!res.ok) throw new Error(await readApiError(res, 'Request failed'));
  return res.json() as Promise<T>;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: formData,
    headers: {
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
  });

  if (res.status === 401 && getRefreshToken() && getUserId()) {
    try {
      const refreshed = await refresh({ userId: getUserId(), refreshToken: getRefreshToken() });
      setAuthTokens(refreshed);
      return upload<T>(path, formData);
    } catch {
      clearAuthTokens();
    }
  }

  if (!res.ok) throw new Error(await readApiError(res, 'Upload failed'));
  return res.json() as Promise<T>;
}

export async function refresh(payload: RefreshPayload): Promise<AuthResponse> {
  const res = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res, 'Refresh failed'));
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

  logout: async () => {
    await request('/auth/logout', { method: 'POST' });
    clearAuthTokens();
  },

  listResumes: () => request<Resume[]>('/resumes'),

  getResume: (id: string) => request<Resume>(`/resumes/${id}`),

  createResume: (payload: ResumePayload) =>
    request<Resume>('/resumes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateResume: (id: string, payload: ResumePayload) =>
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

  downloadPdf: async (id: string) => {
    const res = await fetch(`${baseUrl}/resumes/${id}/pdf`, {
      method: 'GET',
      headers: {
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
    });
    if (!res.ok) throw new Error(await readApiError(res, 'PDF export failed'));
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  getPdfBlob: async (id: string) => {
    const res = await fetch(`${baseUrl}/resumes/${id}/pdf`, {
      method: 'GET',
      headers: {
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
    });
    if (!res.ok) throw new Error(await readApiError(res, 'PDF export failed'));
    return res.blob();
  },
};
