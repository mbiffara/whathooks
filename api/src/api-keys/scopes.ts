import { SetMetadata } from '@nestjs/common';

/**
 * What an API key may do, as `<resource>:<action>`.
 *
 * Before this existed a key was all-or-nothing at the organization level: one
 * issued to a website widget so it could send a message could equally delete a
 * WhatsApp session, log a number out, or disconnect an Instagram account. The
 * key could not be handed to a third party without handing over everything.
 *
 * `read` covers listing and fetching; `write` covers anything that changes
 * state, including destructive operations. They are deliberately coarse — a
 * separate `delete` action would multiply the checkboxes without changing who
 * anyone actually trusts with what.
 */
export const API_KEY_SCOPES = [
  'messages:read',
  'messages:write',
  'sessions:read',
  'sessions:write',
  'mirror:read',
  'mirror:write',
  'instagram:read',
  'instagram:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Resources, for grouping the UI. */
export const SCOPE_RESOURCES = [
  'messages',
  'sessions',
  'mirror',
  'instagram',
] as const;

export const SCOPES_KEY = 'apiKeyScopes';

/**
 * Scopes a route requires of an API key. Ignored for dashboard (JWT)
 * requests, which are governed by org roles instead: a human's permissions
 * are their membership, not a credential's grant list.
 *
 * A route with no decorator stays open to any valid key, which keeps this
 * additive — nothing breaks by not having been annotated yet.
 */
export const RequireScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}
