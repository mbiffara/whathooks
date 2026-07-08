import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CreateSessionDto } from './dto/session.dto';
import { WhatsappService } from './whatsapp.service';

class TestMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly whatsapp: WhatsappService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.whatsapp.list(this.orgOf(user));
  }

  @OrgRoles('ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto) {
    return this.whatsapp.create(this.orgOf(user), dto.label);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.whatsapp.get(this.orgOf(user), id);
  }

  @OrgRoles('ADMIN')
  @Post(':id/connect')
  connect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.whatsapp.connect(this.orgOf(user), id);
  }

  @OrgRoles('ADMIN')
  @Post(':id/logout')
  logout(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.whatsapp.logout(this.orgOf(user), id);
  }

  @Post(':id/test-message')
  testMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TestMessageDto,
  ) {
    return this.whatsapp.sendTest(this.orgOf(user), id, dto.to, dto.text);
  }

  @OrgRoles('ADMIN')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.whatsapp.remove(this.orgOf(user), id);
  }
}
