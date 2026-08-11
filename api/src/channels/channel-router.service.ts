import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';
import { InstagramChannelDriver } from '../instagram/instagram-channel.driver';
import type { ChannelDriver } from './channel-driver';

/**
 * Picks the driver for a session's channel.
 *
 * `driverFor` is synchronous and takes the channel rather than a session id:
 * nearly every caller has already loaded the session row it is about to send
 * on, so making the router fetch it again would add a query per message to
 * hide a value the caller is holding. `driverForSession` exists for the few
 * places that genuinely only have an id.
 */
@Injectable()
export class ChannelRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: ConnectionManagerService,
    private readonly instagram: InstagramChannelDriver,
  ) {}

  driverFor(channel: Channel): ChannelDriver {
    switch (channel) {
      case Channel.WHATSAPP:
        return this.whatsapp;
      case Channel.INSTAGRAM:
        return this.instagram;
      default:
        // `channel` narrows to never once every member is handled, so adding
        // one to the enum without a driver becomes a compile error rather
        // than a runtime surprise. The throw covers a value arriving from the
        // database that TypeScript cannot know about.
        return exhausted(channel);
    }
  }

  async driverForSession(sessionId: string): Promise<ChannelDriver> {
    const session = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
      select: { channel: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.driverFor(session.channel);
  }
}

/** Compile-time exhaustiveness guard for the channel switch. */
function exhausted(channel: never): never {
  throw new ServiceUnavailableException(
    `The ${String(channel)} channel is not available on this server.`,
  );
}
