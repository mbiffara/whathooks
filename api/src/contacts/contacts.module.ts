import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ContactsController } from './contacts.controller';
import { ContactsImportService } from './contacts-import.service';

@Module({
  imports: [AuthModule, WebhooksModule],
  controllers: [ContactsController],
  providers: [ContactsImportService],
})
export class ContactsModule {}
