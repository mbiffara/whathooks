import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuickRepliesController } from './quick-replies.controller';

@Module({
  imports: [AuthModule],
  controllers: [QuickRepliesController],
})
export class QuickRepliesModule {}
