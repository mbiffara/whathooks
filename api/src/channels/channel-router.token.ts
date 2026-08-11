/**
 * Injection token for ChannelRouterService.
 *
 * The router imports every driver, and two drivers need the router back: the
 * WhatsApp manager relays a mirror reply on the lead's channel, and the
 * Instagram ingest forwards a lead into a WhatsApp group. Importing the router
 * *class* from those files is a circular ES import, which leaves one side
 * undefined at class-definition time and shows up as Nest "encountered an
 * undefined dependency" rather than as anything resembling the real cause.
 *
 * Resolving through this token keeps the runtime import graph acyclic; the
 * class is still imported for its type, which erases at compile time.
 */
export const CHANNEL_ROUTER = Symbol('CHANNEL_ROUTER');
