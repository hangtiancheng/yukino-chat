// Copyright (c) 2026 hangtiancheng
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package service

import (
	"context"
	"log"
	"time"

	"github.com/hangtiancheng/yukino-chat/server/internal/constant"
	"github.com/hangtiancheng/yukino-chat/server/internal/dao"
	"github.com/hangtiancheng/yukino-chat/server/internal/model"
	"github.com/hangtiancheng/yukino-chat/server/internal/util"
	"github.com/hangtiancheng/yukino-chat/yukino/ws"

	"github.com/hangtiancheng/yukino.go/yukino_orm"
)

// EnsureYukinoUser creates the reserved Yukino assistant account on startup.
func EnsureYukinoUser(ctx context.Context) {
	var existing model.UserInfo
	err := dao.Engine.Model(&existing).Where("uuid", constant.YukinoUUID).First(ctx, &existing)
	if err == nil {
		return
	}
	if err != yukino_orm.ErrNotFound {
		log.Printf("EnsureYukinoUser: lookup failed: %v", err)
		return
	}
	user := model.UserInfo{
		Uuid:      constant.YukinoUUID,
		Nickname:  constant.YukinoName,
		Signature: constant.YukinoSignature,
		CreatedAt: time.Now(),
		Status:    constant.UserStatusNormal,
	}
	if _, err := dao.Engine.Model(&user).Insert(ctx, &user); err != nil {
		log.Printf("EnsureYukinoUser: insert failed: %v", err)
		return
	}
	log.Printf("Yukino assistant account created (%s)", constant.YukinoUUID)
}

// EnsureYukinoContact idempotently gives a user the undeletable Yukino
// contact and a session pointing at it. Called on register and login so
// existing accounts pick it up too.
func EnsureYukinoContact(ctx context.Context, userId string) {
	if userId == "" || userId == constant.YukinoUUID {
		return
	}
	if err := ensureUserContact(ctx, dao.Engine, userId, constant.YukinoUUID); err != nil {
		log.Printf("EnsureYukinoContact %s: contact failed: %v", userId, err)
		return
	}
	if err := ensureUserContact(ctx, dao.Engine, constant.YukinoUUID, userId); err != nil {
		log.Printf("EnsureYukinoContact %s: reverse contact failed: %v", userId, err)
	}
	ensurePeerSession(ctx, userId, constant.YukinoUUID)
}

// IsYukino reports whether the given uuid is the built-in assistant.
func IsYukino(uuid string) bool {
	return uuid == constant.YukinoUUID
}

// Ws runs the assistant behind Yukino. It stays nil when the server is
// started without a yukino configuration, in which case chat keeps working and
// only the assistant thread reports itself unavailable.
var Ws *ws.Manager

// InitWs starts the assistant runtime. It is called from main rather than
// init so it runs after Mongo and the cache are up.
func InitWs() {
	Ws = ws.NewManager(yukinoSink{})
}

func StopWs() {
	if Ws != nil {
		Ws.Stop()
	}
}

// yukinoSink files the assistant's replies as ordinary chat messages. Going
// through the same insert-and-broadcast path a human peer takes is what gives
// Yukino working history, session previews and unread counts for free.
type yukinoSink struct{}

func (yukinoSink) SaveAssistantText(userID, sessionID, text string) string {
	ctx := bgCtx()
	name, avatar, ok := resolveSender(ctx, constant.YukinoUUID)
	if !ok {
		name = constant.YukinoName
	}
	msg := model.Message{
		Uuid:       "M" + util.GetNowAndLenRandomString(11),
		SessionId:  sessionID,
		Type:       constant.MessageText,
		Content:    text,
		SendId:     constant.YukinoUUID,
		SendName:   name,
		SendAvatar: avatar,
		ReceiveId:  userID,
		Status:     constant.MessageUnsent,
		CreatedAt:  time.Now(),
	}
	if _, err := dao.Engine.Model(&msg).Insert(ctx, &msg); err != nil {
		log.Printf("yukinoSink: insert reply failed: %v", err)
		return ""
	}
	ChatServer.broadcast(ChatMessageRequest{SendAvatar: avatar}, msg, false)
	return msg.Uuid
}

// dispatchToYukino routes a stored direct message into the assistant owned by
// its sender. Group threads are deliberately left out: Yukino only takes part
// in one-to-one conversations.
func dispatchToYukino(msg *model.Message) {
	if !IsYukino(msg.ReceiveId) || msg.SendId == constant.YukinoUUID {
		return
	}
	if Ws == nil {
		return
	}
	if msg.Type != constant.MessageText {
		// Uploads are hidden in the assistant thread, so anything else here
		// came from another client and deserves an answer rather than silence.
		yukinoSink{}.SaveAssistantText(msg.SendId, msg.SessionId,
			"I can only read text messages — please describe what you need in writing.")
		return
	}
	Ws.Dispatch(msg.SendId, msg.SessionId, msg.Uuid, msg.Content)
}
