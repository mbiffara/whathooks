import { Module } from '@nestjs/common';
import { AgentRunnerService } from './agent-runner.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, AgentRunnerService],
  exports: [AgentRunnerService],
})
export class AgentsModule {}
