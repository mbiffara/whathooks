import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';

class SendDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;
}

class AgentPauseDto {
  @IsBoolean()
  paused!: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.list(this.orgOf(user), {
      sessionId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(this.orgOf(user), id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.messages(this.orgOf(user), id, {
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.markRead(this.orgOf(user), id);
  }

  @Post(':id/agent/pause')
  setAgentPaused(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AgentPauseDto,
  ) {
    return this.conversations.setAgentPaused(this.orgOf(user), id, body.paused);
  }

  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('file'))
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SendDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const org = this.orgOf(user);
    if (file) {
      return this.conversations.sendMedia(
        org,
        id,
        {
          buffer: file.buffer,
          mimeType: file.mimetype || 'application/octet-stream',
          fileName: file.originalname,
        },
        body.text,
      );
    }
    if (!body.text) throw new BadRequestException('Provide text or a file');
    return this.conversations.sendText(org, id, body.text);
  }
}
