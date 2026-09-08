import { whatsappIdentity } from './address';

/**
 * The Prisma `where` that finds the contact behind an inbound WhatsApp
 * sender. A DM arrives from a phone jid, or from a LID jid when the number
 * is hidden; when it is a LID we may still know the number, so both
 * identities are tried and either one matches. Null when there is nothing
 * to match on: an Instagram address, or a LID whose number never resolved
 * and that no contact has adopted yet.
 *
 * Shared by contact saving and by the flow node that routes on the contact's
 * human agent, so "is this person in the book" means one thing.
 */
export function contactIdentityWhere(
  organizationId: string,
  remoteJid: string,
  phoneNumberHint?: string | null,
): {
  organizationId: string;
  OR: Array<{ lid: string } | { phoneNumber: string }>;
} | null {
  const wa = whatsappIdentity(remoteJid, phoneNumberHint);
  if (!wa) return null;
  const identities: Array<{ lid: string } | { phoneNumber: string }> = [
    ...(wa.lid ? [{ lid: wa.lid }] : []),
    ...(wa.phoneNumber ? [{ phoneNumber: wa.phoneNumber }] : []),
  ];
  if (identities.length === 0) return null;
  return { organizationId, OR: identities };
}
