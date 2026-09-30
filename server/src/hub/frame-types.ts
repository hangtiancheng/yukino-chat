export interface MessageListItem {
  uuid: string;
  send_id: string;
  send_name: string;
  send_avatar: string;
  receive_id: string;
  type: number;
  content: string;
  url: string;
  file_size: string;
  file_name: string;
  file_type: string;
  created_at: string;
  av_data?: string;
}

export interface ChatFrame {
  session_id: string;
  type: number;
  content: string;
  url: string;
  send_id: string;
  send_name: string;
  send_avatar: string;
  receive_id: string;
  file_type: string;
  file_name: string;
  file_size: string;
  av_data: string;
}

export interface AVSignal {
  messageId: string;
  type: string;
  media: string;
  room_id: string;
}

export const overflowFrame =
  '{"type":-1,"send_id":"","receive_id":"","content":"message send failed, please retry"}';

export const WELCOME_TEXT = "welcome to yukino chat";

// System notification topics carried in the content field of type-5 frames.
export const NotifyContact = "contact";
export const NotifyGroup = "group";
export const NotifyApply = "apply";
export const NotifySession = "session";
export const NotifyOnline = "online";

// Message types.
export const MessageText = 0;
export const MessageImage = 1;
export const MessageFile = 2;
export const MessageAudioOrVideo = 3;
export const MessageVideo = 4;
export const MessageSystem = 5;

// Message delivery status.
export const MessageUnsent = 0;
export const MessageSent = 1;

// User/group/apply status enums (wire ints).
export const UserStatusNormal = 0;
export const UserStatusDisable = 1;

export const ContactNormal = 0;
export const ContactBlack = 1;
export const ContactBeBlack = 2;
export const ContactDelete = 3;
export const ContactBeDelete = 4;
export const ContactMute = 5;
export const ContactQuit = 6;
export const ContactKicked = 7;

export const ContactTypeUser = 0;
export const ContactTypeGroup = 1;

export const ApplyStatusApplying = 0;
export const ApplyStatusPass = 1;
export const ApplyStatusRefuse = 2;
export const ApplyStatusBlack = 3;

export const GroupAddModeDirect = 0;
export const GroupAddModeReview = 1;

export const GroupStatusNormal = 0;
export const GroupStatusDisable = 1;
export const GroupStatusDismiss = 2;
