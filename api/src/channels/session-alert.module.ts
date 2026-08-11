import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SessionAlertService } from './session-alert.service';

/**
 * Standalone for the same reason as MessageStoreModule and AgentReplyModule:
 * the channel modules need it, and ChannelsModule imports them, so it cannot
 * live there without cycling.
 */
@Module({
  imports: [MailModule],
  providers: [SessionAlertService],
  exports: [SessionAlertService],
})
export class SessionAlertModule {}
