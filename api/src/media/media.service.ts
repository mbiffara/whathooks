import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export interface PutResult {
  key: string;
  size: number;
}

/**
 * Object storage for message media. Uses S3 when MEDIA_BUCKET is set, otherwise
 * the local filesystem (dev). View URLs are presigned (S3) or HMAC-signed proxy
 * links (local) so <img>/<audio> can load them without an auth header.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);
  private readonly bucket?: string;
  private readonly s3?: S3Client;
  private readonly localDir: string;
  private readonly publicApiUrl: string;
  private readonly secret: string;
  private readonly ttlSeconds = 3600;
  // viewUrl memoization: stable URLs across polls (see viewUrl docs).
  private readonly urlCache = new Map<
    string,
    { url: string; freshUntil: number }
  >();

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('MEDIA_BUCKET') || undefined;
    this.localDir =
      this.config.get<string>('MEDIA_DIR') || join(process.cwd(), '.media');
    this.publicApiUrl = this.config
      .get<string>('PUBLIC_API_URL', 'http://localhost:3001')
      .replace(/\/$/, '');
    this.secret = this.config.get<string>('JWT_SECRET', 'dev-secret');
    if (this.bucket) {
      this.s3 = new S3Client({
        region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      });
      this.log.log(`Media storage: S3 bucket ${this.bucket}`);
    } else {
      this.log.log(`Media storage: local dir ${this.localDir}`);
    }
  }

  newKey(organizationId: string, sessionId: string, ext: string): string {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    return `media/${organizationId}/${sessionId}/${randomUUID()}.${safeExt}`;
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<PutResult> {
    if (this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } else {
      const path = join(this.localDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    return { key, size: body.length };
  }

  /**
   * A URL the browser can load directly (presigned S3 or signed local proxy).
   * URLs are cached and reused for 75% of their TTL so repeated fetches (the
   * inbox polls every few seconds) return the SAME url — otherwise React sees
   * a new `src` each poll and reloads `<audio>`/`<video>` mid-playback.
   */
  async viewUrl(
    key: string,
    contentType?: string,
    fileName?: string,
  ): Promise<string> {
    const cacheKey = `${key}|${contentType ?? ''}|${fileName ?? ''}`;
    const hit = this.urlCache.get(cacheKey);
    if (hit && hit.freshUntil > Date.now()) return hit.url;
    const url = await this.buildViewUrl(key, contentType, fileName);
    if (this.urlCache.size > 5_000) this.urlCache.clear();
    this.urlCache.set(cacheKey, {
      url,
      freshUntil: Date.now() + this.ttlSeconds * 750, // 75% of ttl, in ms
    });
    return url;
  }

  private async buildViewUrl(
    key: string,
    contentType?: string,
    fileName?: string,
  ): Promise<string> {
    if (this.s3 && this.bucket) {
      return getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: fileName
            ? `inline; filename="${fileName}"`
            : undefined,
        }),
        { expiresIn: this.ttlSeconds },
      );
    }
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const sig = this.sign(key, exp);
    const params = new URLSearchParams({
      key,
      exp: String(exp),
      sig,
      ct: contentType ?? 'application/octet-stream',
    });
    return `${this.publicApiUrl}/v1/media/raw?${params.toString()}`;
  }

  // ---- local-mode proxy helpers ----
  isLocal(): boolean {
    return !this.bucket;
  }

  verifyLocal(key: string, exp: string, sig: string): boolean {
    if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
    return this.sign(key, Number(exp)) === sig;
  }

  async readLocal(key: string): Promise<NodeJS.ReadableStream | null> {
    const path = join(this.localDir, key);
    if (!existsSync(path)) return null;
    return createReadStream(path);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    if (this.s3 && this.bucket) {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    }
    const path = join(this.localDir, key);
    if (!existsSync(path)) return null;
    return readFile(path);
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.s3 && this.bucket) {
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
      } else {
        await rm(join(this.localDir, key), { force: true });
      }
    } catch (e) {
      this.log.warn(`Failed to delete media ${key}: ${e}`);
    }
  }

  private sign(key: string, exp: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}:${exp}`)
      .digest('hex');
  }
}
