import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { MessageStoreService } from './message-store.service';

/**
 * Deliberately separate from ChannelsModule, which imports WhatsappModule to
 * register its driver. WhatsappModule needs the store, so putting the store
 * there would make the two import each other. This module depends on nothing
 * but Prisma and media, so every channel can import it freely.
 */
@Module({
  imports: [MediaModule],
  providers: [MessageStoreService],
  exports: [MessageStoreService],
})
export class MessageStoreModule {}
