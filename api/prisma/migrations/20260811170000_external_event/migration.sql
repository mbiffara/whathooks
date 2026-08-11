-- CreateTable: idempotency ledger for inbound provider webhooks. Zernio
-- documents at-least-once delivery, and a retry also arrives whenever an API
-- deploy interrupts our response, so the same event id lands more than once.
-- The primary key is the provider's own id: inserting it IS the claim, so two
-- concurrent deliveries cannot both win.
CREATE TABLE "ExternalEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalEvent_pkey" PRIMARY KEY ("id")
);

-- Indexed for pruning old rows; nothing queries by time otherwise.
CREATE INDEX "ExternalEvent_receivedAt_idx" ON "ExternalEvent"("receivedAt");
