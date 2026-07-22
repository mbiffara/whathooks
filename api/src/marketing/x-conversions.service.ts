import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Server-side X (Twitter) Conversion API client. Sends ad-attribution events
 * (signup, paid subscription) keyed ONLY by the twclid ad-click id captured
 * on the landing page — no account data (not even hashed) leaves us, matching
 * the privacy policy. Without X_PIXEL_TOKEN + the event id env vars it no-ops
 * quietly; a conversion without a twclid is skipped by design (the user
 * didn't come from an X ad). Fire-and-forget: never throws into callers.
 */
@Injectable()
export class XConversionsService {
  private readonly log = new Logger(XConversionsService.name);

  constructor(private readonly config: ConfigService) {}

  /** Registration completed. */
  trackSignup(twclid: string | null | undefined, conversionId: string): void {
    this.send('X_EVENT_SIGNUP', twclid, conversionId, '/signup');
  }

  /** First paid subscription activated (fired from the Stripe webhook). */
  trackSubscription(
    twclid: string | null | undefined,
    conversionId: string,
  ): void {
    this.send('X_EVENT_SUBSCRIBE', twclid, conversionId, '/dashboard/billing');
  }

  private send(
    eventEnv: string,
    twclid: string | null | undefined,
    conversionId: string,
    path: string,
  ): void {
    const token = this.config.get<string>('X_PIXEL_TOKEN');
    const pixelId = this.config.get<string>('X_PIXEL_ID', 're0yu');
    const eventId = this.config.get<string>(eventEnv);
    if (!token || !eventId || !twclid) return;

    const body = {
      conversions: [
        {
          conversion_time: new Date().toISOString(),
          event_id: eventId,
          event_source_url: `https://www.whathooks.app${path}`,
          conversion_id: conversionId,
          identifiers: [{ twclid }],
        },
      ],
    };
    void fetch(`https://ads-api.x.com/12/measurement/conversions/${pixelId}`, {
      method: 'POST',
      headers: {
        'X-Pixel-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          this.log.warn(
            `X conversions API ${res.status} for ${eventEnv}: ${(await res.text()).slice(0, 200)}`,
          );
        }
      })
      .catch((err) => {
        this.log.warn(`X conversions API failed for ${eventEnv}: ${err}`);
      });
  }
}
