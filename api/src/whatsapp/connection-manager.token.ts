/**
 * Injection token for ConnectionManagerService.
 *
 * The Instagram ingest hands the flow engine its operations host, which is
 * this class. Importing it directly would pull WhatsappModule into
 * InstagramModule while ChannelsModule imports both — a circular ES import
 * that surfaces as an undefined Nest dependency rather than as itself.
 */
export const CONNECTION_MANAGER = Symbol('CONNECTION_MANAGER');
