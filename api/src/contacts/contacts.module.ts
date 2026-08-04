import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ContactsController } from './contacts.controller';

@Module({
  imports: [AuthModule, WebhooksModule],
  controllers: [ContactsController],
})
export class ContactsModule {}
