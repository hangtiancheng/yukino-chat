-- CreateTable
CREATE TABLE "user_info" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "avatar" TEXT NOT NULL DEFAULT '',
    "gender" INTEGER NOT NULL DEFAULT 0,
    "signature" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "birthday" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "last_online_at" DATETIME,
    "last_offline_at" DATETIME,
    "is_admin" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "send_id" TEXT NOT NULL,
    "receive_id" TEXT NOT NULL,
    "receive_name" TEXT NOT NULL DEFAULT '',
    "avatar" TEXT NOT NULL DEFAULT '',
    "last_message" TEXT NOT NULL DEFAULT '',
    "last_message_at" DATETIME,
    "last_read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "send_id" TEXT NOT NULL,
    "send_name" TEXT NOT NULL DEFAULT '',
    "send_avatar" TEXT NOT NULL DEFAULT '',
    "receive_id" TEXT NOT NULL,
    "file_type" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL DEFAULT '',
    "file_size" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "send_at" DATETIME,
    "av_data" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "group_info" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notice" TEXT NOT NULL DEFAULT '',
    "members" JSONB NOT NULL DEFAULT '[]',
    "member_cnt" INTEGER NOT NULL DEFAULT 0,
    "owner_id" TEXT NOT NULL,
    "add_mode" INTEGER NOT NULL DEFAULT 0,
    "avatar" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "user_contact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "contact_type" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "note_name" TEXT NOT NULL DEFAULT '',
    "tag_id" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "contact_apply" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "contact_type" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "last_apply_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "contact_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "context" JSONB NOT NULL DEFAULT '{}',
    "active_skills" JSONB NOT NULL DEFAULT '[]',
    "permission_mode" TEXT NOT NULL DEFAULT 'default',
    "create_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_time" DATETIME NOT NULL,
    "last_active_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_time" DATETIME
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
