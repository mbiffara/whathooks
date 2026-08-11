import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Zernio webhook receiver for Instagram DMs.
 *
 * CAPTURE PHASE. Zernio publishes no schema for `message.received` and no
 * webhook management API, so the payload and the exact `X-Zernio-Signature`
 * format can only be learned by receiving a real delivery. Until then this
 * endpoint logs what arrives and does nothing else — it persists no rows,
 * touches no conversation, and starts no automation, so an unverified public
 * route cannot be used to inject messages.
 *
 * Once a real delivery has been read out of CloudWatch this becomes the real
 * ingest: verify the signature first, dedupe on the event id, persist, then run
 * automation asynchronously (see instagram-dms-plan.md).
 */
@Controller('instagram')
export class InstagramWebhookController {
  private readonly log = new Logger(InstagramWebhookController.name);

  @Post('webhook')
  @HttpCode(200)
  capture(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    // Signature-bearing headers are what we most need to see; log their names
    // and lengths rather than their values so a shared secret is not written
    // to CloudWatch in the clear.
    const signatureish = Object.entries(headers)
      .filter(([k]) => /sign|hmac|digest|timestamp/i.test(k))
      .map(([k, v]) => `${k}(len=${v?.length ?? 0})`);

    const raw = req.rawBody?.toString('utf8') ?? '';
    this.log.log(
      `zernio webhook: content-type=${headers['content-type'] ?? 'none'} ` +
        `bytes=${raw.length} sig-headers=[${signatureish.join(', ')}]`,
    );
    // Truncated: a DM body is personal data and this is a diagnostic, not a
    // store. 4 KB is enough to see every field name and the event envelope.
    this.log.log(`zernio payload: ${raw.slice(0, 4096)}`);

    // Always 200: Zernio retries on failure, and during the capture phase a
    // retry storm would add nothing.
    return { received: true };
  }
}
