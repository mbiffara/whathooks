-- AlterTable: the Instagram add-on. instagramSeats mirrors the quantity on the
-- Stripe subscription item and is only ever written from a webhook, so an
-- unpaid or declined seat request cannot grant entitlement.
ALTER TABLE "Organization" ADD COLUMN "instagramSeats" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Zernio's per-customer tenant boundary, one profile per org,
-- created lazily on the first Instagram connection.
ALTER TABLE "Organization" ADD COLUMN "zernioProfileId" TEXT;
