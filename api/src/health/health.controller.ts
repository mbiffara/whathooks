import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ConnectionManagerService,
  ) {}

  /**
   * The load balancer's view of this task. A task that has handed the
   * WhatsApp sockets to a newer one, or is waiting to receive them, answers
   * 503 so traffic goes to the task that can actually send. A database
   * hiccup stays a 200 with `degraded`: restarting the task would not fix
   * the database, and the sockets are better up than down.
   */
  @Get()
  async check() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const leadership = this.manager.leadershipStatus();
    if (!this.manager.isReady()) {
      throw new ServiceUnavailableException({
        status: 'handover',
        db,
        leadership,
      });
    }
    return { status: db ? 'ok' : 'degraded', db, leadership };
  }
}
