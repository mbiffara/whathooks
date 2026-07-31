import { Controller, Get, Param } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

/**
 * Unauthenticated endpoint backing the public QR-share page (/connect/<token>
 * on the web). The token is the capability: unguessable, 24h validity,
 * revocable. Returns only what the page needs — label, status, QR.
 */
@Controller('public/connect')
export class PublicConnectController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.whatsapp.getByShareToken(token);
  }
}
