-- A mirror group hides the lead's number from the human agent by design.
-- Some businesses want the opposite: the agent should be able to call the
-- lead, so the group opens with the lead's contact card. Opt-in per link.

-- AlterTable
ALTER TABLE "MirrorLink" ADD COLUMN "shareLeadNumber" BOOLEAN NOT NULL DEFAULT false;
