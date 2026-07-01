-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "replyDelayMaxSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replyDelayMinSeconds" INTEGER NOT NULL DEFAULT 0;
