import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import {
  LIBRARY_MAX_FILE_BYTES,
  MediaLibraryService,
} from './media-library.service';

class LibraryFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/**
 * The organization's file library. Members can browse it (the flow editor
 * and the agent settings list it); adding and removing files is an admin
 * action like the rest of the automation configuration.
 */
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('MEMBER')
@Controller('media-library')
export class MediaLibraryController {
  constructor(private readonly library: MediaLibraryService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.library.list(this.orgOf(user));
  }

  @OrgRoles('ADMIN')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LIBRARY_MAX_FILE_BYTES } }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: LibraryFieldsDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Provide a file');
    return this.library.create(
      this.orgOf(user),
      {
        buffer: file.buffer,
        mimeType: file.mimetype || 'application/octet-stream',
        fileName: file.originalname,
      },
      dto,
    );
  }

  @OrgRoles('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LibraryFieldsDto,
  ) {
    return this.library.update(this.orgOf(user), id, dto);
  }

  @OrgRoles('ADMIN')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.remove(this.orgOf(user), id);
  }
}
