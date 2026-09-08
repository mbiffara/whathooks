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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { MAX_CONTACTS_PER_ORG } from './contacts-import';
import { ContactsImportService } from './contacts-import.service';

class ContactFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(/^\d{5,20}$/, { message: 'phoneNumber must be digits only' })
  phoneNumber?: string;

  @IsOptional()
  @Matches(/^\d{5,20}$/, { message: 'lid must be digits only' })
  lid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  instagram?: string;

  // The human agent who looks after this person; "" clears it.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  humanAgentId?: string;
}

class BulkContactRowDto {
  // Whatever the spreadsheet cell held: the import normalizes and reports
  // per row, which a strict pattern here would turn into a 400 for the
  // whole batch.
  @IsString()
  @MaxLength(40)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  humanAgentId?: string;
}

class BulkContactsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkContactRowDto)
  rows!: BulkContactRowDto[];
}

const AGENT_SELECT = { select: { id: true, name: true } };

/** Org-scoped contact book. Any member can manage it. */
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('MEMBER') // the contact book holds customer numbers: operators are out
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatchService,
    private readonly importer: ContactsImportService,
  ) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    /** Only people who have written to this session (org number). */
    @Query('sessionId') sessionId?: string,
    /** Only people looked after by this human agent. */
    @Query('humanAgentId') humanAgentId?: string,
  ) {
    const needle = q?.trim();
    return this.prisma.contact.findMany({
      where: {
        organizationId: this.orgOf(user),
        // Org scope above already prevents reading another org's sessions.
        ...(sessionId ? { sessions: { some: { id: sessionId } } } : {}),
        ...(humanAgentId ? { humanAgentId } : {}),
        ...(needle
          ? {
              OR: [
                { name: { contains: needle, mode: 'insensitive' as const } },
                { phoneNumber: { contains: needle } },
                {
                  company: { contains: needle, mode: 'insensitive' as const },
                },
                { email: { contains: needle, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        sessions: { select: { id: true, label: true } },
        humanAgent: AGENT_SELECT,
      },
    });
  }

  /**
   * One batch of a spreadsheet import (the client chunks the file). Upserts
   * by phone number; see ContactsImportService for what wins on conflict.
   */
  @Post('bulk')
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkContactsDto) {
    return this.importer.importChunk(this.orgOf(user), dto.rows);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: ContactFieldsDto) {
    const organizationId = this.orgOf(user);
    if (!dto.phoneNumber && !dto.lid) {
      throw new BadRequestException('Provide a phone number or a LID');
    }
    const count = await this.prisma.contact.count({
      where: { organizationId },
    });
    if (count >= MAX_CONTACTS_PER_ORG) {
      throw new BadRequestException(
        `An organization can have at most ${MAX_CONTACTS_PER_ORG} contacts`,
      );
    }
    await this.requireFree(organizationId, dto, null);
    await this.requireAgent(organizationId, dto.humanAgentId);
    const contact = await this.prisma.contact.create({
      data: { organizationId, ...clean(dto) },
      include: { humanAgent: AGENT_SELECT },
    });
    void this.webhooks.dispatch({
      organizationId,
      sessionId: null,
      event: 'contact.created',
      payload: contact,
    });
    return contact;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ContactFieldsDto,
  ) {
    const organizationId = this.orgOf(user);
    const existing = await this.prisma.contact.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    await this.requireFree(organizationId, dto, id);
    await this.requireAgent(organizationId, dto.humanAgentId);
    const contact = await this.prisma.contact.update({
      where: { id },
      data: clean(dto),
      include: { humanAgent: AGENT_SELECT },
    });
    void this.webhooks.dispatch({
      organizationId,
      sessionId: null,
      event: 'contact.updated',
      payload: contact,
    });
    return contact;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: this.orgOf(user) },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id } });
    return { ok: true };
  }

  /** A human agent id must belong to this org; blank means "none". */
  private async requireAgent(
    organizationId: string,
    humanAgentId: string | undefined,
  ) {
    if (!humanAgentId?.trim()) return;
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id: humanAgentId.trim(), organizationId },
      select: { id: true },
    });
    if (!agent) throw new BadRequestException('Unknown human agent');
  }

  /** Reject a phone/lid already used by another contact of the org. */
  private async requireFree(
    organizationId: string,
    dto: ContactFieldsDto,
    exceptId: string | null,
  ) {
    for (const key of ['phoneNumber', 'lid'] as const) {
      const value = dto[key];
      if (!value) continue;
      const clash = await this.prisma.contact.findFirst({
        where: {
          organizationId,
          [key]: value,
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          `Another contact already uses that ${key === 'lid' ? 'LID' : 'phone number'}`,
        );
      }
    }
  }
}

/** Trim strings; empty strings become null (clear the field). */
function clean(dto: ContactFieldsDto) {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(dto)) {
    if (typeof v !== 'string') continue;
    out[k] = v.trim() || null;
  }
  return out;
}
