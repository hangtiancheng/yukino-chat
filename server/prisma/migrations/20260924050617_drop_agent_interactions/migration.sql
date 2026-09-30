/*
  Warnings:

  - You are about to drop the `agent_interactions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "agent_interactions" DROP CONSTRAINT "agent_interactions_session_id_fkey";

-- DropTable
DROP TABLE "agent_interactions";

-- DropEnum
DROP TYPE "AgentInteractionStatus";

-- DropEnum
DROP TYPE "AgentInteractionType";
