/**
 * Sounds the inbox can play when a message comes in. The web synthesizes
 * them (web/src/lib/incoming-sound.ts keeps the same list), so adding one
 * means touching both lists and the en/es translations.
 */
export const INCOMING_SOUNDS = [
  'none',
  'chime',
  'pop',
  'ding',
  'double',
] as const;

export type IncomingSound = (typeof INCOMING_SOUNDS)[number];
