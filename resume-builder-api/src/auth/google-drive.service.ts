import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Request, Response as ExpressResponse } from 'express';
import { ResumeService } from '../resume/resume.service';
import { DriveSessionService } from './drive-session.service';
import { GoogleTokenStore } from './tokenStore';

export type GoogleOAuthTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn: number;
  idToken?: string;
};

export type GoogleDriveFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
};

export type GoogleDownloadResult = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export interface GoogleDriveClient {
  exchangeCodeForTokens(code: string): Promise<GoogleOAuthTokenPayload>;
  refreshAccessToken(refreshToken: string): Promise<GoogleOAuthTokenPayload>;
  listResumeFiles(accessToken: string): Promise<{ files: GoogleDriveFileItem[] }>;
  downloadFile(accessToken: string, fileId: string): Promise<GoogleDownloadResult>;
}

export const GOOGLE_DRIVE_CLIENT = Symbol('GOOGLE_DRIVE_CLIENT');

@Injectable()
export class GoogleDriveService {
  constructor(
    private readonly config: ConfigService,
    private readonly driveSessions: DriveSessionService,
    private readonly tokenStore: GoogleTokenStore,
    private readonly resumeService: ResumeService,
    @Inject(GOOGLE_DRIVE_CLIENT) private readonly googleClient: GoogleDriveClient,
  ) {}

  async getDriveSessionStatus(req: Request, res: ExpressResponse, userId: string) {
    const session = await this.driveSessions.ensureSession(req, res, userId);
    const tokens = await this.tokenStore.getGoogleTokens(userId);
    return {
      driveConsentAsked: Boolean(session.consentAsked),
      googleConnected: Boolean(tokens?.accessToken),
      sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  async setDriveConsent(req: Request, res: ExpressResponse, userId: string, decision: 'accepted' | 'declined') {
    const session = await this.driveSessions.ensureSession(req, res, userId);
    await this.driveSessions.markConsentAsked(session);
    if (decision === 'declined') {
      await this.tokenStore.clearGoogleTokens(userId);
    }
    this.driveSessions.attachSessionCookie(res, session.id);
    const tokens = await this.tokenStore.getGoogleTokens(userId);
    return {
      driveConsentAsked: true,
      googleConnected: Boolean(tokens?.accessToken),
      sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  async getGoogleStartUrl(req: Request, res: ExpressResponse, userId: string) {
    const session = await this.driveSessions.ensureSession(req, res, userId);
    const state = randomBytes(18).toString('base64url');
    await this.driveSessions.markConsentAsked(session);
    await this.driveSessions.setOAuthState(session, state);
    this.driveSessions.attachSessionCookie(res, session.id);
    return {
      url: buildGoogleAuthUrl({
        clientId: this.requireConfig('GOOGLE_CLIENT_ID'),
        redirectUri: this.requireConfig('GOOGLE_REDIRECT_URI'),
        state,
      }),
    };
  }

  async handleGoogleCallback(req: Request, res: ExpressResponse, code: string, state: string) {
    const cleanCode = String(code || '').trim();
    const cleanState = String(state || '').trim();
    if (!cleanCode || !cleanState) {
      throw new BadRequestException('Missing OAuth code or state.');
    }

    const session = await this.driveSessions.getSession(req);
    if (!session) {
      throw new UnauthorizedException('Drive session missing or expired.');
    }
    if (!await this.driveSessions.consumeOAuthState(session, cleanState)) {
      throw new UnauthorizedException('Invalid OAuth state.');
    }

    const tokenPayload = await this.googleClient.exchangeCodeForTokens(cleanCode);
    await this.tokenStore.setGoogleTokens(session.userId, {
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiryDate: Date.now() + Math.max(60, Number(tokenPayload.expiresIn || 0)) * 1000,
      tokenType: tokenPayload.tokenType,
      scope: tokenPayload.scope,
      idToken: tokenPayload.idToken,
    });
    this.driveSessions.attachSessionCookie(res, session.id);

    return appendConnectedQuery(this.config.get<string>('GOOGLE_OAUTH_SUCCESS_REDIRECT', 'http://localhost:3000/dashboard'));
  }

  async listDriveFiles(req: Request, res: ExpressResponse, userId: string) {
    const session = await this.assertConnectedSession(req, res, userId);
    const accessToken = await this.ensureAccessToken(userId);
    const files = await this.googleClient.listResumeFiles(accessToken);
    await this.driveSessions.extend(session);
    this.driveSessions.attachSessionCookie(res, session.id);
    return files;
  }

  async importDriveFile(req: Request, res: ExpressResponse, userId: string, fileId: string) {
    const session = await this.assertConnectedSession(req, res, userId);
    const cleanFileId = String(fileId || '').trim();
    if (!cleanFileId) {
      throw new BadRequestException('fileId is required.');
    }

    const accessToken = await this.ensureAccessToken(userId);
    const downloaded = await this.googleClient.downloadFile(accessToken, cleanFileId);
    const parsed = await this.resumeService.parseResumeUpload(
      {
        originalname: downloaded.fileName,
        mimetype: downloaded.mimeType,
        size: downloaded.buffer.length,
        buffer: downloaded.buffer,
      },
      {
        mode: 'extract-and-map',
        title: stripExtension(downloaded.fileName),
      },
    );
    await this.driveSessions.extend(session);
    this.driveSessions.attachSessionCookie(res, session.id);
    return {
      persisted: false,
      file: {
        fileId: cleanFileId,
        fileName: downloaded.fileName,
        mimeType: downloaded.mimeType,
      },
      resume: parsed,
    };
  }

  async extendDriveSession(req: Request, res: ExpressResponse, userId: string) {
    const session = await this.driveSessions.ensureSession(req, res, userId);
    await this.driveSessions.extend(session);
    this.driveSessions.attachSessionCookie(res, session.id);
    return {
      ok: true,
      sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  private async ensureAccessToken(userId: string) {
    const current = await this.tokenStore.getGoogleTokens(userId);
    if (!current?.accessToken) {
      throw new UnauthorizedException('Google Drive is not connected. Please connect again.');
    }

    const now = Date.now();
    if (Number(current.expiryDate || 0) > now + 30_000) {
      return current.accessToken;
    }
    if (!current.refreshToken) {
      await this.tokenStore.clearGoogleTokens(userId);
      throw new UnauthorizedException('Google access token expired. Please reconnect Google Drive.');
    }

    try {
      const refreshed = await this.googleClient.refreshAccessToken(current.refreshToken);
      const rotated = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || current.refreshToken,
        tokenType: refreshed.tokenType || current.tokenType,
        scope: refreshed.scope || current.scope,
        idToken: refreshed.idToken || current.idToken,
        expiryDate: Date.now() + Math.max(60, Number(refreshed.expiresIn || 0)) * 1000,
      };
      await this.tokenStore.setGoogleTokens(userId, rotated);
      return rotated.accessToken;
    } catch {
      await this.tokenStore.clearGoogleTokens(userId);
      throw new UnauthorizedException('Google session expired. Please reconnect Google Drive.');
    }
  }

  private async assertConnectedSession(req: Request, res: ExpressResponse, userId: string) {
    const session = await this.driveSessions.ensureSession(req, res, userId);
    const stored = await this.tokenStore.getGoogleTokens(userId);
    if (!stored?.accessToken) {
      throw new ForbiddenException('Connect Google Drive first.');
    }
    return session;
  }

  private requireConfig(name: string) {
    const value = String(this.config.get<string>(name, '') || '').trim();
    if (!value) {
      throw new InternalServerErrorException(`${name} is not configured.`);
    }
    return value;
  }
}

@Injectable()
export class GoogleDriveHttpClient implements GoogleDriveClient {
  constructor(private readonly config: ConfigService) {}

  async exchangeCodeForTokens(code: string): Promise<GoogleOAuthTokenPayload> {
    return this.requestToken({
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.requireConfig('GOOGLE_REDIRECT_URI'),
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleOAuthTokenPayload> {
    return this.requestToken({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
  }

  async listResumeFiles(accessToken: string): Promise<{ files: GoogleDriveFileItem[] }> {
    const query = "trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType = 'application/msword' or mimeType = 'text/plain' or mimeType = 'application/vnd.google-apps.document')";
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '30');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size)');
    url.searchParams.set('q', query);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new ForbiddenException('Unable to list Google Drive files.');
    }
    const payload = await safeJson(response);
    const files = Array.isArray(payload?.files)
      ? payload.files
          .map((file) => ({
            id: String(file?.id || '').trim(),
            name: String(file?.name || '').trim(),
            mimeType: String(file?.mimeType || '').trim(),
            modifiedTime: file?.modifiedTime ? String(file.modifiedTime) : undefined,
            size: file?.size ? String(file.size) : undefined,
          }))
          .filter((file) => file.id && file.name && file.mimeType)
      : [];
    return { files };
  }

  async downloadFile(accessToken: string, fileId: string): Promise<GoogleDownloadResult> {
    const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    metaUrl.searchParams.set('fields', 'id,name,mimeType');
    const metadataResponse = await fetch(metaUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!metadataResponse.ok) {
      throw new ForbiddenException('Unable to read selected Drive file metadata.');
    }
    const metadata = await safeJson(metadataResponse);
    const fileName = String(metadata?.name || '').trim() || 'imported-resume.txt';
    const mimeType = String(metadata?.mimeType || '').trim() || 'application/octet-stream';

    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    let resolvedMimeType = mimeType;
    if (mimeType === 'application/vnd.google-apps.document') {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
      resolvedMimeType = 'text/plain';
    }

    const dataResponse = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!dataResponse.ok) {
      throw new ForbiddenException('Unable to download selected Drive file.');
    }
    const arrayBuffer = await dataResponse.arrayBuffer();
    return {
      fileName,
      mimeType: resolvedMimeType,
      buffer: Buffer.from(arrayBuffer),
    };
  }

  private async requestToken(payload: Record<string, string>): Promise<GoogleOAuthTokenPayload> {
    const params = new URLSearchParams();
    params.set('client_id', this.requireConfig('GOOGLE_CLIENT_ID'));
    params.set('client_secret', this.requireConfig('GOOGLE_CLIENT_SECRET'));
    for (const [key, value] of Object.entries(payload)) {
      params.set(key, value);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!response.ok) {
      throw new ForbiddenException('Google OAuth token exchange failed.');
    }
    const data = await safeJson(response);
    const accessToken = String(data?.access_token || '').trim();
    if (!accessToken) {
      throw new ForbiddenException('Google OAuth token exchange returned no access token.');
    }
    return {
      accessToken,
      refreshToken: data?.refresh_token ? String(data.refresh_token).trim() : undefined,
      tokenType: data?.token_type ? String(data.token_type).trim() : undefined,
      scope: data?.scope ? String(data.scope).trim() : undefined,
      expiresIn: Number(data?.expires_in || 3600),
      idToken: data?.id_token ? String(data.id_token).trim() : undefined,
    };
  }

  private requireConfig(name: string) {
    const value = String(this.config.get<string>(name, '') || '').trim();
    if (!value) {
      throw new InternalServerErrorException(`${name} is not configured.`);
    }
    return value;
  }
}

function buildGoogleAuthUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/drive.readonly');
  url.searchParams.set('state', input.state);
  return url.toString();
}

function appendConnectedQuery(raw: string) {
  const fallback = 'http://localhost:3000/dashboard';
  const base = String(raw || '').trim() || fallback;
  try {
    const url = new URL(base);
    url.searchParams.set('drive', 'connected');
    return url.toString();
  } catch {
    return `${fallback}?drive=connected`;
  }
}

function stripExtension(fileName: string) {
  const clean = String(fileName || '').trim();
  if (!clean) return 'Imported Resume';
  return clean.replace(/\.[a-z0-9]+$/i, '') || clean;
}

async function safeJson(response: globalThis.Response): Promise<Record<string, any>> {
  try {
    return await response.json() as Record<string, any>;
  } catch {
    return {};
  }
}
