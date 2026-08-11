import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { identifyScheme } from './zernio-signature';

/**
 * Zernio webhook receiver for Instagram DMs.
 *
 * CAPTURE PHASE, now with report-only signature analysis. Zernio documents
 * neither the payload nor what its `X-Zernio-Signature` covers, and a real
 * delivery carries *two* 64-hex headers (`x-zernio-signature` and
 * `x-late-signature`). Rather than guess which bytes are signed — and either
 * reject genuine deliveries or wave through forged ones — every plausible
 * scheme is computed and the matching one logged. Once the logs agree across
 * several deliveries, switch to `verifyZernioSignature` with that scheme and
 * reject on failure.
 *
 * Until then this endpoint still persists nothing, touches no conversation and
 * starts no automation, so remaining unauthenticated cannot be used to inject
 * messages.
 */
@Controller('instagram')
export class InstagramWebhookController {
  private readonly log = new Logger(InstagramWebhookController.name);

  constructor(private readonly config: ConfigService) {}

  @Post('webhook')
  @HttpCode(200)
  capture(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';

    // Envelope fields feed the candidate schemes; a malformed body must not
    // take the endpoint down, so parsing is best-effort.
    let envelope: { id?: string; event?: string; timestamp?: string } = {};
    try {
      envelope = JSON.parse(raw) as typeof envelope;
    } catch {
      /* logged below via bytes/event=none */
    }

    const secret = this.config.get<string>('ZERNIO_WEBHOOK_SECRET');
    const report = secret
      ? identifyScheme(raw, secret, headers, {
          id: envelope.id,
          timestamp: envelope.timestamp,
        })
      : { matches: [], present: ['(no ZERNIO_WEBHOOK_SECRET configured)'] };

    this.log.log(
      `zernio webhook: event=${envelope.event ?? 'none'} id=${envelope.id ?? 'none'} ` +
        `bytes=${raw.length} sig-headers=[${report.present.join(', ')}] ` +
        `sig-match=[${report.matches.join(', ') || 'NONE'}]`,
    );
    // Truncated: a DM body is personal data and this is a diagnostic, not a
    // store. 4 KB is enough to see every field name and the event envelope.
    this.log.log(`zernio payload: ${raw.slice(0, 4096)}`);

    // Always 200: Zernio retries on failure, and during the capture phase a
    // retry storm would add nothing.
    return { received: true };
  }
}
