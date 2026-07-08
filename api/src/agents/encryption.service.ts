import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM encryption for provider API keys stored per agent. The 32-byte
 * key is derived (SHA-256) from AGENT_ENCRYPTION_KEY, so any sufficiently long
 * secret string works — in prod it's a generated Secrets Manager secret.
 * Ciphertext format: base64(iv).base64(authTag).base64(ct).
 */
@Injectable()
export class EncryptionService {
  private readonly log = new Logger(EncryptionService.name);
  private readonly key?: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('AGENT_ENCRYPTION_KEY');
    if (raw && raw.length >= 16) {
      this.key = createHash('sha256').update(raw, 'utf8').digest();
    } else if (raw) {
      this.log.error(
        'AGENT_ENCRYPTION_KEY too short (need ≥16 chars) — ignored',
      );
    } else {
      this.log.warn(
        'AGENT_ENCRYPTION_KEY not set — agent API keys can’t be stored',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.key;
  }

  encrypt(plaintext: string): string {
    if (!this.key) throw new Error('Encryption not configured');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join('.');
  }

  decrypt(payload: string): string {
    if (!this.key) throw new Error('Encryption not configured');
    const [ivB64, tagB64, ctB64] = payload.split('.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** A safe display hint for a secret, e.g. "sk-…aB12". */
  hint(secret: string): string {
    if (secret.length <= 8) return '…' + secret.slice(-2);
    return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
  }
}
