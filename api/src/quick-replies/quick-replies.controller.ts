import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateQuickReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;
}

class UpdateQuickReplyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text?: string;

  // Empty string clears the title.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;
}

const MAX_QUICK_REPLIES_PER_ORG = 50;
const SELECT = { id: true, title: true, text: true, updatedAt: true } as const;

/** Org-scoped canned responses for the inbox. Any member can manage them. */
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly prisma: PrismaService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.quickReply.findMany({
      where: { organizationId: this.orgOf(user) },
      orderBy: { updatedAt: 'desc' },
      select: SELECT,
    });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuickReplyDto,
  ) {
    const organizationId = this.orgOf(user);
    const text = dto.text.trim();
    if (!text) throw new BadRequestException('Text is empty');
    // Saving the same message twice from the inbox is a no-op, not a dupe.
    const existing = await this.prisma.quickReply.findFirst({
      where: { organizationId, text },
      select: SELECT,
    });
    if (existing) return existing;
    const count = await this.prisma.quickReply.count({
      where: { organizationId },
    });
    if (count >= MAX_QUICK_REPLIES_PER_ORG) {
      throw new BadRequestException(
        `An organization can have at most ${MAX_QUICK_REPLIES_PER_ORG} quick replies`,
      );
    }
    return this.prisma.quickReply.create({
      data: { organizationId, text, title: dto.title?.trim() || null },
      select: SELECT,
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    await this.require(user, id);
    const text = dto.text?.trim();
    if (dto.text !== undefined && !text) {
      throw new BadRequestException('Text is empty');
    }
    return this.prisma.quickReply.update({
      where: { id },
      data: {
        ...(text !== undefined ? { text } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() || null } : {}),
      },
      select: SELECT,
    });
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.require(user, id);
    await this.prisma.quickReply.delete({ where: { id } });
    return { ok: true };
  }

  private async require(user: AuthUser, id: string) {
    const reply = await this.prisma.quickReply.findFirst({
      where: { id, organizationId: this.orgOf(user) },
      select: { id: true },
    });
    if (!reply) throw new NotFoundException('Quick reply not found');
    return reply;
  }
}
