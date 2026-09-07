import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportPlan,
  ImportRow,
  MAX_CONTACTS_PER_ORG,
  planImport,
} from './contacts-import';

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: ImportPlan['skipped'];
}

/**
 * One batch of a bulk import. The client chunks a spreadsheet into batches
 * and posts them in order; each batch is one transaction, so a failure
 * (the org cap, a dropped connection) leaves the earlier batches applied
 * and this one untouched, which the client reports as-is.
 *
 * Imports do not fire contact.created / contact.updated webhooks: a
 * thousand-row sheet would queue a thousand deliveries nobody asked for.
 */
@Injectable()
export class ContactsImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importChunk(
    organizationId: string,
    rows: ImportRow[],
  ): Promise<ImportResult> {
    const agentIds = [
      ...new Set(
        rows.flatMap((r) => (r.humanAgentId?.trim() ? [r.humanAgentId] : [])),
      ),
    ];
    const known = agentIds.length
      ? await this.prisma.humanAgent.findMany({
          where: { organizationId, id: { in: agentIds } },
          select: { id: true },
        })
      : [];
    const knownAgentIds = new Set(known.map((a) => a.id));

    return this.prisma.$transaction(
      async (tx) => {
        // Every candidate number in one read; the plan decides the rest.
        const phones = rows.flatMap((r) => {
          const digits = String(r.phoneNumber).replace(/[^0-9]/g, '');
          return digits ? [digits] : [];
        });
        const existing = await tx.contact.findMany({
          where: { organizationId, phoneNumber: { in: phones } },
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            humanAgentId: true,
          },
        });
        const plan = planImport(
          rows,
          existing.filter(
            (c): c is typeof c & { phoneNumber: string } =>
              c.phoneNumber !== null,
          ),
          knownAgentIds,
        );

        if (plan.toCreate.length > 0) {
          const count = await tx.contact.count({ where: { organizationId } });
          const room = MAX_CONTACTS_PER_ORG - count;
          if (plan.toCreate.length > room) {
            throw new BadRequestException(
              room > 0
                ? `Only ${room} more contacts fit in this organization (limit ${MAX_CONTACTS_PER_ORG})`
                : `An organization can have at most ${MAX_CONTACTS_PER_ORG} contacts`,
            );
          }
          // skipDuplicates covers a contact auto-saved from an inbound
          // message between the read above and this write.
          await tx.contact.createMany({
            data: plan.toCreate.map((c) => ({ organizationId, ...c })),
            skipDuplicates: true,
          });
        }
        // Sequential on purpose: an interactive transaction holds one
        // connection, so parallel updates gain nothing.
        for (const u of plan.toUpdate) {
          await tx.contact.update({ where: { id: u.id }, data: u.data });
        }
        return {
          created: plan.toCreate.length,
          updated: plan.toUpdate.length,
          unchanged: plan.unchanged,
          skipped: plan.skipped,
        };
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}
