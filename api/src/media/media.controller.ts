import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * Public, HMAC-signed proxy used in local (non-S3) mode so the browser can
   * load media directly. In S3 mode view URLs point straight at S3 and this is
   * unused.
   */
  @Get('raw')
  async raw(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('ct') ct: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!key || !this.media.verifyLocal(key, exp, sig)) {
      throw new NotFoundException();
    }
    const stream = await this.media.readLocal(key);
    if (!stream) throw new NotFoundException();
    res.setHeader('Content-Type', ct || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(stream as Readable);
  }
}
