import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';

/**
 * Global like MediaModule: the flow engine (WhatsappModule) and the agent
 * reply path (AgentReplyModule) both resolve library files, and neither
 * should have to import a module that only wraps Prisma and the media store.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
