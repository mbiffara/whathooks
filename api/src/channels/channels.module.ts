import { Module } from '@nestjs/common';
import { InstagramModule } from '../instagram/instagram.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ChannelRouterService } from './channel-router.service';
import { CHANNEL_ROUTER } from './channel-router.token';

/**
 * The seam between "send a message on a session" and "which transport that
 * session actually uses". Imports WhatsappModule for the one driver that
 * exists today; further channels register their driver here.
 */
@Module({
  imports: [WhatsappModule, InstagramModule],
  providers: [
    ChannelRouterService,
    // Same instance under a token, so drivers can resolve the router without
    // importing its class and creating a circular ES import.
    { provide: CHANNEL_ROUTER, useExisting: ChannelRouterService },
  ],
  exports: [ChannelRouterService, CHANNEL_ROUTER],
})
export class ChannelsModule {}
