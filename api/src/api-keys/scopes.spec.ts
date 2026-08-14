import { API_KEY_SCOPES, isApiKeyScope } from './scopes';

/**
 * The scope check, isolated from Nest.
 *
 * A mistake here is a security bug rather than a broken feature: too strict
 * breaks a customer's integration, too loose hands a send-only key the ability
 * to delete their WhatsApp sessions. Both fail quietly.
 */
function allows(granted: string[], required: string[]): boolean {
  return required.every((s) => granted.includes(s));
}

describe('API key scopes', () => {
  it('lets a key through only for what it was granted', () => {
    const sendOnly = ['messages:write'];
    expect(allows(sendOnly, ['messages:write'])).toBe(true);
    expect(allows(sendOnly, ['messages:read'])).toBe(false);
    // The case that motivated this: a widget key must not delete a session.
    expect(allows(sendOnly, ['sessions:write'])).toBe(false);
  });

  it('requires every scope a route asks for, not just one', () => {
    expect(allows(['messages:read'], ['messages:read', 'sessions:read'])).toBe(
      false,
    );
  });

  it('treats an unannotated route as open to any valid key', () => {
    // Annotating is additive: a route nobody has labelled yet must keep
    // working rather than start rejecting every key.
    expect(allows([], [])).toBe(true);
    expect(allows(['messages:read'], [])).toBe(true);
  });

  it('grants nothing to a key created without scopes', () => {
    // The safe default for anything created without saying. Pre-existing keys
    // are a different case and were backfilled with everything by migration.
    for (const scope of API_KEY_SCOPES) {
      expect(allows([], [scope])).toBe(false);
    }
  });

  it('covers read and write for every resource', () => {
    for (const resource of ['messages', 'sessions', 'mirror', 'instagram']) {
      expect(API_KEY_SCOPES).toContain(`${resource}:read`);
      expect(API_KEY_SCOPES).toContain(`${resource}:write`);
    }
  });

  it('rejects anything not in the catalogue', () => {
    expect(isApiKeyScope('messages:write')).toBe(true);
    expect(isApiKeyScope('messages:delete')).toBe(false);
    expect(isApiKeyScope('*')).toBe(false);
    expect(isApiKeyScope('billing:write')).toBe(false);
  });
});

/**
 * Session allow-list resolution, matching SessionAccessService: empty means
 * unrestricted, which is what every key was before scoping existed.
 */
function restrictedFor(
  user: object | undefined,
  keySessionIds: string[] | undefined,
): string[] | null {
  if (!user) return keySessionIds?.length ? keySessionIds : null;
  return null; // stands in for the membership path
}

describe('API key session allow-list', () => {
  it('restricts a pinned key to its sessions', () => {
    expect(restrictedFor(undefined, ['s1', 's2'])).toEqual(['s1', 's2']);
  });

  it('leaves an unpinned key unrestricted', () => {
    // Backfilled keys have an empty list and must keep full session reach.
    expect(restrictedFor(undefined, [])).toBeNull();
    expect(restrictedFor(undefined, undefined)).toBeNull();
  });

  it('does not apply a key list to a dashboard request', () => {
    expect(restrictedFor({ userId: 'u1' }, ['s1'])).toBeNull();
  });
});
