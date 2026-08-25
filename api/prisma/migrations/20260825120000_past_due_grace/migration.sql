-- `past_due` used to be treated exactly like `active` for as long as it
-- lasted. Two things went wrong with that: a trial whose first charge was
-- declined lost its trial caps (the status was no longer `trialing`) and got
-- the full plan for free, and a subscription Stripe never got round to
-- cancelling kept sending indefinitely. These two columns let the quota
-- service tell those cases apart and put a clock on both.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "firstPaidAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "pastDueSince" TIMESTAMP(3);

-- Backfill. An org that is `active` today has paid at least once: a trial
-- shows as `trialing`, and Stripe only flips to `active` once the first
-- invoice settles. The exact date is unknown, so "now" stands in; what
-- matters is that a later declined renewal is treated as a lapsed customer,
-- not as a trial that never converted.
UPDATE "Organization"
SET "firstPaidAt" = now()
WHERE "subscriptionStatus" = 'active' AND "firstPaidAt" IS NULL;

-- Orgs already past due start their grace period at deploy time. That is
-- generous (some have been past due for weeks) but it means nobody is cut
-- off the moment this ships, before the banner and email have had a chance
-- to land.
UPDATE "Organization"
SET "pastDueSince" = now()
WHERE "subscriptionStatus" = 'past_due' AND "pastDueSince" IS NULL;
