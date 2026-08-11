/**
 * Conversation addresses.
 *
 * WhatsApp addresses are Baileys JIDs — `<msisdn>@s.whatsapp.net`, `<lid>@lid`
 * when the number is hidden, or `<id>@g.us` for a group. Channels that reach us
 * over an API have no such structure, so their provider id is stored behind a
 * scheme prefix (`ig:<zernioConversationId>`).
 *
 * The prefix earns its keep: `Conversation.remoteJid` is read in a dozen places
 * that assume a JID, and several of them render the part before the `@` as a
 * phone number. Prefixing means any site we missed produces something visibly
 * wrong instead of quietly showing a provider id to a customer as if it were
 * their contact's number.
 */

/** Scheme prefix for a channel whose addresses are opaque provider ids. */
const INSTAGRAM_SCHEME = 'ig:';

/** Build the stored address for an Instagram thread. */
export function instagramAddress(conversationId: string): string {
  return `${INSTAGRAM_SCHEME}${conversationId}`;
}

export function isInstagramAddress(address: string): boolean {
  return address.startsWith(INSTAGRAM_SCHEME);
}

/** The provider id behind an Instagram address, or null if it isn't one. */
export function instagramConversationId(address: string): string | null {
  return isInstagramAddress(address)
    ? address.slice(INSTAGRAM_SCHEME.length)
    : null;
}

/**
 * Groups are a WhatsApp concept; no other channel we support lets a business
 * account create a multi-party thread, so this is false everywhere else.
 */
export function isGroupAddress(address: string): boolean {
  return address.endsWith('@g.us');
}

/**
 * The raw addressing identity: a phone number, or a LID when WhatsApp hides the
 * number. Null for channels where the address is an opaque provider id — those
 * carry their identity in `Conversation.name` / `WaSession.externalHandle`
 * instead, and showing the id would be worse than showing nothing.
 */
export function addressIdentity(address: string): string | null {
  if (isInstagramAddress(address)) return null;
  return address.split('@')[0] || null;
}

/**
 * Split a WhatsApp JID into the identities we store on `Contact`. Returns null
 * for any non-WhatsApp address, whose contact identity is channel-specific
 * (Instagram uses the handle, via `Contact.instagram`).
 */
export function whatsappIdentity(
  address: string,
  phoneNumberHint?: string | null,
): { lid: string | null; phoneNumber: string | null } | null {
  if (isInstagramAddress(address)) return null;
  const [user, host] = address.split('@');
  if (!user) return null;
  const lid = host === 'lid' ? user : null;
  return {
    lid,
    phoneNumber: host === 'lid' ? (phoneNumberHint ?? null) : user,
  };
}

/**
 * Best-effort human label for an address when the conversation has no name
 * cached — `+5491122334455` on WhatsApp, and the address itself elsewhere
 * (an Instagram thread always has a handle in `name` by the time we render it).
 */
export function addressLabel(address: string, name?: string | null): string {
  if (name) return name;
  const identity = addressIdentity(address);
  return identity ? `+${identity}` : address;
}
