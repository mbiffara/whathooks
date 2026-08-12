import { Channel } from '@prisma/client';
import type { FlowNodeType } from '../flows/flow-graph';

/**
 * What each channel can actually do.
 *
 * This exists because the same bug shipped twice: a flow enabled on an
 * Instagram session did nothing, and a Mirror Link on an Instagram session did
 * nothing. Both were configurable, both looked correct, and both failed in
 * silence. Each was fixed by teaching the *runtime* about channels, which does
 * not stop the next one — the editors still offer whatever they like.
 *
 * One table, read by validation and by the UI, so a new channel inherits every
 * guard instead of reintroducing every gap.
 */
export interface ChannelCapabilities {
  /**
   * Can a business account open a multi-party thread here? Only WhatsApp can,
   * which is why a mirror group for an Instagram lead is hosted on a WhatsApp
   * number rather than on the lead's own channel.
   */
  hostsGroups: boolean;
  /** Group mentions ("@5491122334455"), a WhatsApp group concept. */
  mentions: boolean;
  /** Connected by scanning a QR, as opposed to an OAuth redirect. */
  qrPairing: boolean;
  /** Can show a "typing…" indicator while an agent composes. */
  typingIndicator: boolean;
}

export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
  WHATSAPP: {
    hostsGroups: true,
    mentions: true,
    qrPairing: true,
    typingIndicator: true,
  },
  INSTAGRAM: {
    hostsGroups: false,
    mentions: false,
    qrPairing: false,
    typingIndicator: false,
  },
};

/**
 * Flow nodes that hand a conversation to a human through a mirror group.
 *
 * They still work on a channel that cannot host groups, but only by borrowing
 * a WhatsApp number — so they need one to exist. Without it the flow throws
 * mid-conversation with a customer waiting, which is the failure this whole
 * file is meant to move to configuration time.
 */
export const GROUP_HANDOFF_NODES: FlowNodeType[] = [
  'assignHuman',
  'roundRobin',
  'assignGroup',
];

export function capabilitiesOf(channel: Channel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? CHANNEL_CAPABILITIES.WHATSAPP;
}
