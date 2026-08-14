-- API keys become scopeable. Until now a key was all-or-nothing at the
-- organization level: a key issued to send messages could also delete a
-- session, log a number out, or disconnect an Instagram account.

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ApiKey" ADD COLUMN "sessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every key that exists today was issued with full access, and
-- narrowing a live credential would break working integrations with no
-- warning and no way for the customer to see why. They keep what they had;
-- only newly created keys are scoped.
UPDATE "ApiKey"
SET "scopes" = ARRAY[
  'messages:read',  'messages:write',
  'sessions:read',  'sessions:write',
  'mirror:read',    'mirror:write',
  'instagram:read', 'instagram:write'
]
WHERE cardinality("scopes") = 0;
