-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "sessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
