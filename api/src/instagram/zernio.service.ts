import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://zernio.com/api/v1';

/**
 * Thin client over Zernio's REST API.
 *
 * Three things about this API drive the shape here:
 *
 * 1. **Envelopes differ per endpoint** — `{ profiles }`, `{ accounts }`,
 *    `{ data }`, `{ status, messages, pagination }`, `{ success, data }`. There
 *    is no one unwrapper; each method knows its own.
 * 2. **Two conversation id spaces.** `platformConversationId` is the only key
 *    that works for both reading and sending; the internal `conversationId`
 *    returns an empty 200 on reads. Everything here takes the platform id.
 * 3. **Failures are often 200s.** Where the API reports success in-band
 *    (`{ success: false }`) that is checked explicitly rather than trusting
 *    the status code.
 */
@Injectable()
export class ZernioService {
  private readonly log = new Logger(ZernioService.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!this.config.get<string>('ZERNIO_API_KEY');
  }

  private async call<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const key = this.config.get<string>('ZERNIO_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException('Instagram is not configured');
    }
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // A non-JSON body means we hit their dashboard SPA rather than an API
      // route — i.e. the path does not exist. Worth saying plainly.
      throw new ServiceUnavailableException(
        `Zernio returned a non-JSON response for ${path} (${res.status})`,
      );
    }
    if (!res.ok) {
      const err = json as { error?: string };
      throw new ServiceUnavailableException(
        err.error ?? `Zernio request failed (${res.status})`,
      );
    }
    return json as T;
  }

  /** Profiles are Zernio's tenant boundary: one per whathooks organization. */
  async createProfile(name: string): Promise<string> {
    const r = await this.call<{ profile: { _id: string } }>('/profiles', {
      method: 'POST',
      body: { name, description: 'whathooks organization' },
    });
    return r.profile._id;
  }

  /**
   * OAuth URL for connecting an Instagram account into a profile.
   *
   * `redirect_url` is honoured (it is carried inside `state`), so the customer
   * lands back in whathooks rather than finishing on Zernio's own page.
   */
  async instagramAuthUrl(
    profileId: string,
    redirectUrl: string,
  ): Promise<string> {
    const q = new URLSearchParams({
      profileId,
      redirect_url: redirectUrl,
    });
    const r = await this.call<{ authUrl: string }>(`/connect/instagram?${q}`);
    return r.authUrl;
  }

  async listAccounts(): Promise<ZernioAccount[]> {
    const r = await this.call<{ accounts: ZernioAccount[] }>('/accounts');
    return r.accounts ?? [];
  }

  /**
   * Send a DM. `attachmentType` is required whenever there is an attachment:
   * Zernio forwards it to Meta's message[attachment][type] and defaults to
   * `file` without it, which delivers photos as downloadable documents and
   * voice notes as something the recipient cannot play — with a 200 either way.
   */
  async sendMessage(args: {
    accountId: string;
    platformConversationId: string;
    message?: string;
    attachmentUrl?: string;
    attachmentType?: 'image' | 'video' | 'audio' | 'file';
  }): Promise<{ messageId: string }> {
    const { platformConversationId, ...body } = args;
    const r = await this.call<{
      success: boolean;
      data?: { messageId: string };
      error?: string;
    }>(`/inbox/conversations/${platformConversationId}/messages`, {
      method: 'POST',
      body,
    });
    if (!r.success || !r.data?.messageId) {
      throw new ServiceUnavailableException(
        r.error ?? 'Instagram did not accept the message',
      );
    }
    return { messageId: r.data.messageId };
  }
}

/** Only the fields we rely on; Zernio returns many more. */
export interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  displayName?: string;
  profilePicture?: string;
  isActive?: boolean;
  needsReconnection?: boolean;
  /** ~60 days out. Without a watchdog, accounts die silently at this date. */
  tokenExpiresAt?: string;
  /** Object here, but a bare string in webhook payloads. */
  profileId?: { _id: string; name: string } | string;
}
