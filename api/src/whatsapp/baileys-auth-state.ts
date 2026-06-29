import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { PrismaService } from '../prisma/prisma.service';

// Round-trips a value through BufferJSON so Buffers/Uint8Arrays are encoded as
// plain JSON (and back), which Prisma's Json columns can store.
function encode(value: unknown): any {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}
function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

export interface PrismaAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Baileys auth state backed by Postgres (via Prisma), so a connected socket can
 * be restored after a process restart. Mirrors `useMultiFileAuthState`.
 */
export async function usePrismaAuthState(
  prisma: PrismaService,
  sessionId: string,
): Promise<PrismaAuthState> {
  const existing = await prisma.waCredential.findUnique({
    where: { sessionId },
  });
  const creds: AuthenticationCreds = existing
    ? decode<AuthenticationCreds>(existing.creds)
    : initAuthCreds();

  const saveCreds = async () => {
    const data = encode(creds);
    await prisma.waCredential.upsert({
      where: { sessionId },
      create: { sessionId, creds: data },
      update: { creds: data },
    });
  };

  const clear = async () => {
    await prisma.$transaction([
      prisma.waSignalKey.deleteMany({ where: { sessionId } }),
      prisma.waCredential.deleteMany({ where: { sessionId } }),
    ]);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await prisma.waSignalKey.findMany({
            where: { sessionId, category: type, keyId: { in: ids } },
          });
          const result: {
            [id: string]: SignalDataTypeMap[typeof type];
          } = {};
          for (const row of rows) {
            let value = decode<any>(row.data);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[row.keyId] = value;
          }
          return result;
        },
        set: async (data) => {
          const ops: Promise<unknown>[] = [];
          for (const category of Object.keys(data)) {
            const entries = (data as any)[category] as Record<string, unknown>;
            for (const keyId of Object.keys(entries)) {
              const value = entries[keyId];
              if (value) {
                const encoded = encode(value);
                ops.push(
                  prisma.waSignalKey.upsert({
                    where: {
                      sessionId_category_keyId: { sessionId, category, keyId },
                    },
                    create: { sessionId, category, keyId, data: encoded },
                    update: { data: encoded },
                  }),
                );
              } else {
                ops.push(
                  prisma.waSignalKey.deleteMany({
                    where: { sessionId, category, keyId },
                  }),
                );
              }
            }
          }
          await Promise.all(ops);
        },
      },
    },
    saveCreds,
    clear,
  };
}
