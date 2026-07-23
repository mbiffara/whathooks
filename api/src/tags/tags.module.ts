import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TagsController } from './tags.controller';

@Module({
  imports: [AuthModule],
  controllers: [TagsController],
})
export class TagsModule {}
