import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionAccessService } from '../auth/session-access.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
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

  // Full replacement set of tag ids.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagIds?: string[];
}

class CreateMirrorDto {
  @IsString()
  humanAgentId!: string;

  // Seed the group with the conversation so far.
  @IsOptional()
  @IsBoolean()
  copyHistory?: boolean;
}

class NoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

class StartConversationDto {
  @IsString()
  sessionId!: string;

  // Phone number (digits, with country code) or a full WhatsApp JID.
  @IsString()
  @MinLength(5)
  @MaxLength(64)
  to!: string;
}

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly access: SessionAccessService,
  ) {}

  private allowedFor(user: AuthUser) {
    return this.access.restrictedSessionIds(user, this.orgOf(user));
  }

  /** Operators only act on conversations assigned to them (orgRole is
   *  stamped by OrgRolesGuard on every request). */
  private assignedOnly(user: AuthUser): string | null {
    return user.orgRole === 'OPERATOR' ? user.userId : null;
  }

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
    @Query('tag') tag?: string,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.list(this.orgOf(user), {
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
        tagId: tag,
        allowed,
        assignedTo: this.assignedOnly(user),
      }),
    );
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body() body: StartConversationDto) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.start(
        this.orgOf(user),
        body,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateConversationDto,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.update(
        this.orgOf(user),
        id,
        body,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const allowed = await this.allowedFor(user);
    return this.conversations.get(
      this.orgOf(user),
      id,
      allowed,
      this.assignedOnly(user),
    );
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.messages(
        this.orgOf(user),
        id,
        { before, limit: limit ? Number(limit) : undefined },
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: NoteDto,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.addNote(
        this.orgOf(user),
        id,
        body.text,
        user.userId,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.markRead(
        this.orgOf(user),
        id,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Post(':id/agent/pause')
  setAgentPaused(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AgentPauseDto,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.setAgentPaused(
        this.orgOf(user),
        id,
        body.paused,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  /** Hand the thread to a human agent over WhatsApp (mirror group). */
  @Post(':id/mirror')
  createMirror(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CreateMirrorDto,
  ) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.createMirror(
        this.orgOf(user),
        id,
        body,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  @Delete(':id/mirror')
  removeMirror(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.allowedFor(user).then((allowed) =>
      this.conversations.removeMirror(
        this.orgOf(user),
        id,
        allowed,
        this.assignedOnly(user),
      ),
    );
  }

  /** Platform-admin testing tool — resets flow/relay state with the thread. */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.remove(this.orgOf(user), id);
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
      const allowed = await this.access.restrictedSessionIds(user, org);
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
        allowed,
        this.assignedOnly(user),
      );
    }
    if (!body.text) throw new BadRequestException('Provide text or a file');
    const allowed = await this.access.restrictedSessionIds(user, org);
    return this.conversations.sendText(
      org,
      id,
      body.text,
      user.userId,
      allowed,
      this.assignedOnly(user),
    );
  }
}
