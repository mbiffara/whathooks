import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ConnectionManagerService,
  ) {}

  async send(organizationId: string, dto: SendMessageDto) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'CONNECTED' || !this.manager.isLive(session.id)) {
      throw new BadRequestException('Session is not connected');
    }

    const result = await this.manager.sendText(session.id, dto.to, dto.text);
    return {
      id: result.logId,
      waMessageId: result.waMessageId,
      sessionId: session.id,
      to: dto.to,
      status: 'SENT',
    };
  }

  async list(
    organizationId: string,
    opts: { sessionId?: string; limit?: number },
  ) {
    return this.prisma.messageLog.findMany({
      where: {
        organizationId,
        sessionId: opts.sessionId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
  }
}
