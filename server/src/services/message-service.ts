import { fmtDateTime } from "../common/time.js";
import type { PrismaDB } from "../database/prisma.js";
import type { MessageListItem } from "../hub/frame-types.js";

const toMessageListItem = (m: {
  uuid: string;
  sendId: string;
  sendName: string;
  sendAvatar: string;
  receiveId: string;
  type: number;
  content: string;
  url: string;
  fileSize: string;
  fileName: string;
  fileType: string;
  createdAt: Date;
}): MessageListItem => ({
  uuid: m.uuid,
  send_id: m.sendId,
  send_name: m.sendName,
  send_avatar: m.sendAvatar,
  receive_id: m.receiveId,
  type: m.type,
  content: m.content,
  url: m.url,
  file_size: m.fileSize,
  file_name: m.fileName,
  file_type: m.fileType,
  created_at: fmtDateTime(m.createdAt),
});

export class MessageService {
  constructor(private readonly db: PrismaDB) {}

  async getMessageList(
    sendId: string,
    receiveId: string,
  ): Promise<[string, MessageListItem[] | null, number]> {
    const messages = await this.db.message.findMany({
      where: {
        OR: [
          { sendId, receiveId },
          { sendId: receiveId, receiveId: sendId },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return ["success", messages.map(toMessageListItem), 0];
  }

  // Only group members may read the group's history.
  async getGroupMessageList(
    userId: string,
    groupId: string,
  ): Promise<[string, MessageListItem[] | null, number]> {
    const group = await this.db.groupInfo.findFirst({
      where: { uuid: groupId, deletedAt: null },
    });
    if (!group) return ["Internal Server Error", null, -1];
    if (!group.members.includes(userId)) {
      return ["you are not a member of this group", null, -2];
    }
    const messages = await this.db.message.findMany({
      where: { receiveId: groupId },
      orderBy: { createdAt: "asc" },
    });
    return ["success", messages.map(toMessageListItem), 0];
  }
}
