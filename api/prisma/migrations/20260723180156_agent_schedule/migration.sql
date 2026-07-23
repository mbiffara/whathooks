-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "scheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleEndMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduleStartMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC';
