import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';
import { AgentReplyService } from './agent-reply.service';

/**
 * Separate from ChannelsModule for the same reason MessageStoreModule is:
 * ChannelsModule imports the channel modules to register their drivers, and
 * those channels need this service, so putting it there would cycle. This one
 * depends only on agents, billing, mail and Prisma.
 */
@Module({
  imports: [AgentsModule, BillingModule, MailModule],
  providers: [AgentReplyService],
  exports: [AgentReplyService],
})
export class AgentReplyModule {}
