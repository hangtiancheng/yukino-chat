ALTER TABLE "agent_interactions" DROP CONSTRAINT "agent_interactions_session_id_fkey";

DROP TABLE "agent_interactions";

DROP TYPE "AgentInteractionStatus";

DROP TYPE "AgentInteractionType";
