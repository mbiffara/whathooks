import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OutboundFile } from '../channels/channel-driver';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';

const MB = 1024 * 1024;
/**
 * The tightest channel cap (Instagram video/audio/pdf) so a library file is
 * never one a channel refuses on size alone. Format is checked per channel
 * at flow save time instead, because the same file may be fine on WhatsApp.
 */
export const LIBRARY_MAX_FILE_BYTES = 25 * MB;
export const LIBRARY_MAX_ITEMS = 50;

/**
 * What the library takes at all. Anything a chat client can render inline
 * plus the document types people actually send to customers. Executables and
 * archives are refused: nothing in the product sends those on purpose.
 */
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const SELECT = {
  id: true,
  name: true,
  description: true,
  mimeType: true,
  fileName: true,
  size: true,
  storageKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface MediaLibraryItemView {
  id: string;
  name: string;
  description: string | null;
  mimeType: string;
  fileName: string;
  size: number;
  /** Signed URL for previewing in the dashboard. */
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Org-owned files that automations may send: the sendMedia flow node and the
 * agents' send_media tool both resolve an item id through `load`, which is
 * scoped to the organization — so a flow or a model can only ever name a
 * file that belongs to the org it runs for.
 */
@Injectable()
export class MediaLibraryService {
  private readonly log = new Logger(MediaLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list(organizationId: string): Promise<MediaLibraryItemView[]> {
    const rows = await this.prisma.mediaLibraryItem.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: SELECT,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  /**
   * The compact listing the flow editor and the agent prompt need: enough to
   * pick a file and to validate it against a channel, no signed URLs.
   */
  async summaries(organizationId: string) {
    return this.prisma.mediaLibraryItem.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        mimeType: true,
        fileName: true,
        size: true,
      },
    });
  }

  async create(
    organizationId: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
    fields: { name?: string | null; description?: string | null },
  ): Promise<MediaLibraryItemView> {
    const mimeType = baseMime(file.mimeType);
    if (!isAllowedMime(mimeType)) {
      throw new BadRequestException(
        `Files of type ${mimeType} cannot be sent from the library`,
      );
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException('The file is empty');
    }
    if (file.buffer.length > LIBRARY_MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File is too large (max ${LIBRARY_MAX_FILE_BYTES / MB} MB)`,
      );
    }
    const count = await this.prisma.mediaLibraryItem.count({
      where: { organizationId },
    });
    if (count >= LIBRARY_MAX_ITEMS) {
      throw new BadRequestException(
        `An organization can keep at most ${LIBRARY_MAX_ITEMS} files in its library`,
      );
    }
    const fileName = safeFileName(file.fileName);
    const name = fields.name?.trim() || stripExtension(fileName);
    const key = this.media.newKey(organizationId, 'library', extOf(fileName));
    await this.media.put(key, file.buffer, mimeType);
    try {
      const row = await this.prisma.mediaLibraryItem.create({
        data: {
          organizationId,
          name: name.slice(0, 80),
          description: fields.description?.trim().slice(0, 500) || null,
          storageKey: key,
          mimeType,
          fileName,
          size: file.buffer.length,
        },
        select: SELECT,
      });
      return this.view(row);
    } catch (e) {
      // The row is what makes the object reachable; without it the upload is
      // an orphan, so undo it rather than leak storage on every failed save.
      await this.media.delete(key);
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    fields: { name?: string; description?: string },
  ): Promise<MediaLibraryItemView> {
    await this.require(organizationId, id);
    const name = fields.name?.trim();
    if (fields.name !== undefined && !name) {
      throw new BadRequestException('Name is empty');
    }
    const row = await this.prisma.mediaLibraryItem.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.slice(0, 80) } : {}),
        ...(fields.description !== undefined
          ? { description: fields.description.trim().slice(0, 500) || null }
          : {}),
      },
      select: SELECT,
    });
    return this.view(row);
  }

  async remove(organizationId: string, id: string): Promise<{ ok: true }> {
    const row = await this.require(organizationId, id);
    await this.prisma.mediaLibraryItem.delete({ where: { id } });
    await this.media.delete(row.storageKey);
    return { ok: true };
  }

  /**
   * The file as something a channel driver can send. Null when the id is
   * not one of this organization's: callers treat that as "skip", since a
   * flow node or an agent that names a missing file is a configuration
   * problem, not a reason to fail the conversation.
   */
  async load(
    organizationId: string,
    id: string,
  ): Promise<(OutboundFile & { name: string }) | null> {
    const row = await this.prisma.mediaLibraryItem.findFirst({
      where: { id, organizationId },
      select: SELECT,
    });
    if (!row) return null;
    const buffer = await this.media.getBuffer(row.storageKey);
    if (!buffer) {
      this.log.warn(`Library item ${id} has no object at ${row.storageKey}`);
      return null;
    }
    return {
      buffer,
      mimeType: row.mimeType,
      fileName: row.fileName,
      name: row.name,
    };
  }

  private async require(organizationId: string, id: string) {
    const row = await this.prisma.mediaLibraryItem.findFirst({
      where: { id, organizationId },
      select: SELECT,
    });
    if (!row) throw new NotFoundException('File not found');
    return row;
  }

  private async view(row: {
    id: string;
    name: string;
    description: string | null;
    mimeType: string;
    fileName: string;
    size: number;
    storageKey: string;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<MediaLibraryItemView> {
    const { storageKey, ...rest } = row;
    return {
      ...rest,
      url: await this.media.viewUrl(storageKey, row.mimeType, row.fileName),
    };
  }
}

function baseMime(mimeType: string): string {
  return (
    mimeType.split(';')[0].trim().toLowerCase() || 'application/octet-stream'
  );
}

function isAllowedMime(mime: string): boolean {
  return (
    ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    ALLOWED_MIME_TYPES.has(mime)
  );
}

/** Keep the name a chat client will show, minus anything path-like. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() || 'file';
  return base.slice(0, 120);
}

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  return m ? m[1].toLowerCase() : 'bin';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,8}$/i, '') || fileName;
}
