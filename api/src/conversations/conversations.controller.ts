import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
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

class UpdateConversationDto {
  // null explicitly unassigns; absent leaves it unchanged.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  assignedToUserId?: string | null;

  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED'])
  status?: 'OPEN' | 'RESOLVED';
}

@UseGuards(JwtAuthGuard, OrgRolesGuard)
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
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('assigned') assigned?: string,
  ) {
    return this.conversations.list(this.orgOf(user), {
      sessionId,
      limit: limit ? Number(limit) : undefined,
      q,
      status:
        status === 'OPEN' || status === 'RESOLVED' || status === 'ALL'
          ? status
          : undefined,
      assigned:
        assigned === 'me' || assigned === 'unassigned' || assigned === 'all'
          ? assigned
          : undefined,
      userId: user.userId,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateConversationDto,
  ) {
    return this.conversations.update(this.orgOf(user), id, body);
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
        user.userId,
      );
    }
    if (!body.text) throw new BadRequestException('Provide text or a file');
    return this.conversations.sendText(org, id, body.text, user.userId);
  }
}
