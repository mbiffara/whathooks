import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

const MAX_TAGS_PER_ORG = 30;

/** Org-scoped conversation labels. Any member can manage them. */
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.tag.findMany({
      where: { organizationId: this.orgOf(user) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTagDto) {
    const organizationId = this.orgOf(user);
    const count = await this.prisma.tag.count({ where: { organizationId } });
    if (count >= MAX_TAGS_PER_ORG) {
      throw new BadRequestException(
        `An organization can have at most ${MAX_TAGS_PER_ORG} tags`,
      );
    }
    const name = dto.name.trim();
    const existing = await this.prisma.tag.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
    if (existing) return existing;
    return this.prisma.tag.create({
      data: { organizationId, name, color: dto.color ?? '#25d366' },
      select: { id: true, name: true, color: true },
    });
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, organizationId: this.orgOf(user) },
    });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.tag.delete({ where: { id } });
    return { ok: true };
  }
}
