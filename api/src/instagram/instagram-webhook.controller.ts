import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { InstagramIngestService } from './instagram-ingest.service';
import {
  ZERNIO_SCHEME,
  ZERNIO_SIGNATURE_HEADER,
  ZERNIO_SIGNATURE_HEADER_ALT,
  identifyScheme,
  verifyZernioSignature,
} from './zernio-signature';

/**
 * Zernio webhook receiver for Instagram DMs.
 *
 * Signature enforcement is on: the digest is HMAC-SHA256 over the raw body
 * with the secret we chose at registration, confirmed against two real
 * deliveries (see zernio-signature.ts). An unsigned or mismatched request is
 * refused, because this route is public and will shortly be persisting
 * messages and triggering AI replies.
 *
 * Verified deliveries are acknowledged immediately and processed off the
 * response, because persisting (and later, replying) takes seconds and a
 * sender that times out retries. InstagramIngestService owns the dedupe, so a
 * retry is harmless either way.
 */
@Controller('instagram')
export class InstagramWebhookController {
  private readonly log = new Logger(InstagramWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ingest: InstagramIngestService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  capture(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';

    // Best-effort: a malformed body must be rejected by the signature check,
    // not by a parse error before it.
    let envelope: {
      id?: string;
      event?: string;
      timestamp?: string;
      [k: string]: unknown;
    } = {};
    try {
      envelope = JSON.parse(raw) as typeof envelope;
    } catch {
      /* surfaces below as event=none */
    }

    const secret = this.config.get<string>('ZERNIO_WEBHOOK_SECRET');
    if (!secret) {
      // Fail closed. A missing secret must not silently downgrade a public
      // endpoint to unauthenticated.
      this.log.error('ZERNIO_WEBHOOK_SECRET is not configured; refusing');
      throw new ForbiddenException('Webhook verification unavailable');
    }

    const fields = { id: envelope.id, timestamp: envelope.timestamp };
    const ok =
      verifyZernioSignature(
        raw,
        secret,
        headers[ZERNIO_SIGNATURE_HEADER],
        ZERNIO_SCHEME,
        fields,
      ) ||
      verifyZernioSignature(
        raw,
        secret,
        headers[ZERNIO_SIGNATURE_HEADER_ALT],
        ZERNIO_SCHEME,
        fields,
      );

    if (!ok) {
      // Report which candidate (if any) would have matched — that is what
      // turns "they changed the scheme" from a mystery into a log line.
      const report = identifyScheme(raw, secret, headers, fields);
      this.log.warn(
        `zernio webhook REJECTED: event=${envelope.event ?? 'none'} ` +
          `bytes=${raw.length} sig-headers=[${report.present.join(', ')}] ` +
          `would-match=[${report.matches.join(', ') || 'NONE'}]`,
      );
      throw new ForbiddenException('Invalid signature');
    }

    this.log.log(
      `zernio webhook: event=${envelope.event ?? 'none'} id=${envelope.id ?? 'none'} bytes=${raw.length}`,
    );

    // Acknowledge immediately and process off the response. Persisting, and
    // later replying, take seconds; a sender that times out retries, and a
    // retry we then process again is only harmless because of the dedupe
    // ledger — better not to provoke it at all.
    void this.ingest.handle(envelope).catch((err: unknown) => {
      this.log.error(
        `zernio ${envelope.event ?? 'event'} ${envelope.id ?? ''} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return { received: true };
  }
}
