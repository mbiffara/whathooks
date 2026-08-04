-- AlterTable
ALTER TABLE "MirrorThread" ADD COLUMN     "agentNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];
