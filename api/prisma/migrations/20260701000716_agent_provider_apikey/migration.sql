/*
  Warnings:

  - Added the required column `apiKeyCiphertext` to the `Agent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiKeyHint` to the `Agent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AgentProvider" AS ENUM ('ANTHROPIC', 'OPENAI');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "apiKeyCiphertext" TEXT NOT NULL,
ADD COLUMN     "apiKeyHint" TEXT NOT NULL,
ADD COLUMN     "provider" "AgentProvider" NOT NULL DEFAULT 'ANTHROPIC';
