import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, JwtOrApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard, JwtOrApiKeyGuard],
})
export class ApiKeysModule {}
