import { Module } from '@nestjs/common';
import { InstagramModule } from '../instagram/instagram.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ChannelRouterService } from './channel-router.service';

/**
 * The seam between "send a message on a session" and "which transport that
 * session actually uses". Imports WhatsappModule for the one driver that
 * exists today; further channels register their driver here.
 */
@Module({
  imports: [WhatsappModule, InstagramModule],
  providers: [ChannelRouterService],
  exports: [ChannelRouterService],
})
export class ChannelsModule {}
