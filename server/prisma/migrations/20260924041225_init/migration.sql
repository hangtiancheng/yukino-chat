-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('IDLE', 'RUNNING', 'WAITING', 'COMPLETED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentInteractionType" AS ENUM ('PERMISSION', 'QUESTION');

-- CreateEnum
CREATE TYPE "AgentInteractionStatus" AS ENUM ('PENDING', 'ANSWERED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "user_info" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "telephone" VARCHAR(32) NOT NULL,
    "nickname" VARCHAR(128) NOT NULL DEFAULT '',
    "email" VARCHAR(128) NOT NULL DEFAULT '',
    "avatar" VARCHAR(512) NOT NULL DEFAULT '',
    "gender" INTEGER NOT NULL DEFAULT 0,
    "signature" VARCHAR(512) NOT NULL DEFAULT '',
    "password" VARCHAR(128) NOT NULL DEFAULT '',
    "birthday" VARCHAR(32) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "last_online_at" TIMESTAMP(3),
    "last_offline_at" TIMESTAMP(3),
    "is_admin" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "send_id" VARCHAR(32) NOT NULL,
    "receive_id" VARCHAR(32) NOT NULL,
    "receive_name" VARCHAR(128) NOT NULL DEFAULT '',
    "avatar" VARCHAR(512) NOT NULL DEFAULT '',
    "last_message" TEXT NOT NULL DEFAULT '',
    "last_message_at" TIMESTAMP(3),
    "last_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "session_id" VARCHAR(32) NOT NULL,
    "type" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "url" VARCHAR(512) NOT NULL DEFAULT '',
    "send_id" VARCHAR(32) NOT NULL,
    "send_name" VARCHAR(128) NOT NULL DEFAULT '',
    "send_avatar" VARCHAR(512) NOT NULL DEFAULT '',
    "receive_id" VARCHAR(32) NOT NULL,
    "file_type" VARCHAR(64) NOT NULL DEFAULT '',
    "file_name" VARCHAR(255) NOT NULL DEFAULT '',
    "file_size" VARCHAR(32) NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "send_at" TIMESTAMP(3),
    "av_data" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_info" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "notice" TEXT NOT NULL DEFAULT '',
    "members" TEXT[],
    "member_cnt" INTEGER NOT NULL DEFAULT 0,
    "owner_id" VARCHAR(32) NOT NULL,
    "add_mode" INTEGER NOT NULL DEFAULT 0,
    "avatar" VARCHAR(512) NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contact" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "contact_id" VARCHAR(32) NOT NULL,
    "contact_type" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "note_name" VARCHAR(128) NOT NULL DEFAULT '',
    "tag_id" VARCHAR(32) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_apply" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "contact_id" VARCHAR(32) NOT NULL,
    "contact_type" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "message" VARCHAR(512) NOT NULL DEFAULT '',
    "last_apply_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_apply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tag" (
    "id" SERIAL NOT NULL,
    "uuid" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'IDLE',
    "context" JSONB NOT NULL DEFAULT '{}',
    "active_skills" JSONB NOT NULL DEFAULT '[]',
    "permission_mode" VARCHAR(32) NOT NULL DEFAULT 'default',
    "create_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_time" TIMESTAMP(3) NOT NULL,
    "last_active_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_time" TIMESTAMP(3),

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_interactions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" "AgentInteractionType" NOT NULL,
    "status" "AgentInteractionStatus" NOT NULL DEFAULT 'PENDING',
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "create_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_time" TIMESTAMP(3) NOT NULL,
    "expires_time" TIMESTAMP(3),
    "answered_time" TIMESTAMP(3),

    CONSTRAINT "agent_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_info_uuid_key" ON "user_info"("uuid");

-- CreateIndex
CREATE INDEX "idx_user_info_telephone" ON "user_info"("telephone");

-- CreateIndex
CREATE UNIQUE INDEX "session_uuid_key" ON "session"("uuid");

-- CreateIndex
CREATE INDEX "idx_session_send_receive" ON "session"("send_id", "receive_id");

-- CreateIndex
CREATE INDEX "idx_session_receive" ON "session"("receive_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_uuid_key" ON "message"("uuid");

-- CreateIndex
CREATE INDEX "idx_message_send_receive_created" ON "message"("send_id", "receive_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_message_receive_created" ON "message"("receive_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "group_info_uuid_key" ON "group_info"("uuid");

-- CreateIndex
CREATE INDEX "idx_group_info_owner" ON "group_info"("owner_id");

-- CreateIndex
CREATE INDEX "idx_user_contact_pair" ON "user_contact"("user_id", "contact_id");

-- CreateIndex
CREATE INDEX "idx_user_contact_contact" ON "user_contact"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_apply_uuid_key" ON "contact_apply"("uuid");

-- CreateIndex
CREATE INDEX "idx_contact_apply_contact_status" ON "contact_apply"("contact_id", "status");

-- CreateIndex
CREATE INDEX "idx_contact_apply_pair" ON "contact_apply"("user_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tag_uuid_key" ON "contact_tag"("uuid");

-- CreateIndex
CREATE INDEX "idx_contact_tag_user" ON "contact_tag"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_user_id_key" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_agent_sessions_user_update" ON "agent_sessions"("user_id", "update_time");

-- CreateIndex
CREATE INDEX "idx_agent_interactions_session_status" ON "agent_interactions"("session_id", "status");

-- AddForeignKey
ALTER TABLE "agent_interactions" ADD CONSTRAINT "agent_interactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
