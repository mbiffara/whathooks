import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MessageStoreModule } from '../channels/message-store.module';
import { AgentReplyModule } from '../channels/agent-reply.module';
import { SessionAlertModule } from '../channels/session-alert.module';
import { AuthModule } from '../auth/auth.module';
import { AgentsModule } from '../agents/agents.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ConnectionManagerService } from './connection-manager.service';
import { CONNECTION_MANAGER } from './connection-manager.token';
import { FlowEngineService } from './flow-engine.service';
import { MirrorController } from './mirror.controller';
import { MirrorService } from './mirror.service';
import { PublicConnectController } from './public-connect.controller';
import { SessionsController } from './sessions.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [
    AuthModule,
    MailModule,
    WebhooksModule,
    AgentsModule,
    BillingModule,
    ApiKeysModule,
    MessageStoreModule,
    AgentReplyModule,
    SessionAlertModule,
  ],
  controllers: [SessionsController, PublicConnectController, MirrorController],
  providers: [
    ConnectionManagerService,
    // Same instance under a token, so another channel can hand it to the flow
    // engine without importing the class and cycling the module graph.
    { provide: CONNECTION_MANAGER, useExisting: ConnectionManagerService },
    WhatsappService,
    MirrorService,
    FlowEngineService,
  ],
  exports: [
    ConnectionManagerService,
    CONNECTION_MANAGER,
    WhatsappService,
    FlowEngineService,
  ],
})
export class WhatsappModule {}
