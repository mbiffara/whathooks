import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiOrg } from '../common/decorators/org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** Programmatic send — authenticated with an API key. */
  @UseGuards(ApiKeyGuard)
  @Post()
  send(@ApiOrg() organizationId: string, @Body() dto: SendMessageDto) {
    return this.messages.send(organizationId, dto);
  }

  /** Dashboard message log — authenticated with the user session (JWT). */
  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return this.messages.list(user.organizationId, {
      sessionId,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
