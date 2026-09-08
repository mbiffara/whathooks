-- The per-send quota check counts this month's messages for the org. With
-- only (organizationId) indexed it walks every message the org ever had and
-- filters by date afterwards; on a disk-starved instance that was seconds.

-- CreateIndex
CREATE INDEX "Message_organizationId_createdAt_idx" ON "Message"("organizationId", "createdAt");
