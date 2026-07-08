import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AgentsModule } from './agents/agents.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { MessagesModule } from './messages/messages.module';
import { MetricsModule } from './metrics/metrics.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    MediaModule,
    AuthModule,
    WebhooksModule,
    WhatsappModule,
    ApiKeysModule,
    MessagesModule,
    ConversationsModule,
    AgentsModule,
    OrganizationsModule,
    MetricsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
