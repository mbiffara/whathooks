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
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';

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
}

const MAX_CONTACTS_PER_ORG = 5000;

/** Org-scoped contact book. Any member can manage it. */
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('MEMBER') // the contact book holds customer numbers: operators are out
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatchService,
  ) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    const needle = q?.trim();
    return this.prisma.contact.findMany({
      where: {
        organizationId: this.orgOf(user),
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
      include: { sessions: { select: { id: true, label: true } } },
    });
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
    const contact = await this.prisma.contact.create({
      data: { organizationId, ...clean(dto) },
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
    const contact = await this.prisma.contact.update({
      where: { id },
      data: clean(dto),
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
