/**
 * One-off cleanup: remove conversations that were never real threads.
 *
 * WhatsApp Status/stories (status@broadcast), broadcast lists and channels
 * were ingested as conversations before commit 7977320 added a filter, and
 * their images and videos were downloaded into the media store. Those rows
 * are hidden from the inbox now, but they still occupy the database and,
 * more expensively, object storage.
 *
 * Dry run by default — prints what it would delete and exits:
 *   cd api && npx ts-node scripts/purge-broadcast-conversations.ts
 *
 * Add --delete to actually remove them:
 *   cd api && npx ts-node scripts/purge-broadcast-conversations.ts --delete
 *
 * DATABASE_URL (and the media store env) must point at the target
 * environment. Deleting is irreversible: the messages and the stored media
 * are gone, though nothing on anyone's phone is touched.
 */
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { MediaService } from '../src/media/media.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Same predicate the ingestion filter and list() use.
const WHERE: Prisma.ConversationWhereInput = {
  OR: [
    { remoteJid: { endsWith: '@broadcast' } },
    { remoteJid: { endsWith: '@newsletter' } },
  ],
};

async function main() {
  const apply = process.argv.includes('--delete');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const media = app.get(MediaService);

  const conversations = await prisma.conversation.findMany({
    where: WHERE,
    select: { id: true, remoteJid: true, organizationId: true },
  });
  if (conversations.length === 0) {
    console.log('Nothing to clean up.');
    await app.close();
    return;
  }
  const ids = conversations.map((c) => c.id);
  const messages = await prisma.message.count({
    where: { conversationId: { in: ids } },
  });
  const assets = await prisma.mediaAsset.findMany({
    where: { message: { conversationId: { in: ids } } },
    select: { storageKey: true, size: true },
  });
  const bytes = assets.reduce((sum, a) => sum + (a.size ?? 0), 0);

  const byKind = conversations.reduce<Record<string, number>>((acc, c) => {
    const kind =
      c.remoteJid === 'status@broadcast'
        ? 'status'
        : c.remoteJid.endsWith('@newsletter')
          ? 'channel'
          : 'broadcast list';
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log('Conversations to remove:', conversations.length);
  for (const [kind, n] of Object.entries(byKind))
    console.log(`  ${kind}: ${n}`);
  console.log('Messages:', messages);
  console.log(
    'Stored media objects:',
    assets.length,
    `(${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(
    'Organizations affected:',
    new Set(conversations.map((c) => c.organizationId)).size,
  );

  if (!apply) {
    console.log('\nDry run. Re-run with --delete to remove them.');
    await app.close();
    return;
  }

  // Storage first: the asset rows cascade away with their messages, so once
  // the conversations are gone the keys are unrecoverable.
  let deleted = 0;
  for (const a of assets) {
    await media.delete(a.storageKey); // logs and swallows its own failures
    if (++deleted % 100 === 0) {
      console.log(`  media ${deleted}/${assets.length}`);
    }
  }
  console.log(`Deleted ${deleted} media objects.`);

  // Plain-string reference, no FK — not covered by the cascade below.
  await prisma.flowConversationState.deleteMany({
    where: { conversationId: { in: ids } },
  });
  const removed = await prisma.conversation.deleteMany({ where: WHERE });
  console.log(`Deleted ${removed.count} conversations (messages cascaded).`);

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
