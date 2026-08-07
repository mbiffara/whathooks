import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AgentRunnerService } from './agent-runner.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EncryptionService } from './encryption.service';

@Module({
  imports: [BillingModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRunnerService, EncryptionService],
  exports: [AgentRunnerService],
})
export class AgentsModule {}
