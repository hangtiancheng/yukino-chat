export class CallManager {
  private rooms = new Map<string, Set<string>>();
  private users = new Map<string, string>();

  static roomId(sendId: string, receiveId: string): string {
    if (receiveId.startsWith("G")) return receiveId;
    if (sendId.startsWith("G")) return sendId;
    const [a, b] = sendId < receiveId ? [sendId, receiveId] : [receiveId, sendId];
    return `P:${a}:${b}`;
  }

  isBusy(uuid: string): boolean {
    return this.users.get(uuid) !== undefined;
  }

  inRoom(roomId: string, uuid: string): boolean {
    return this.rooms.get(roomId)?.has(uuid) ?? false;
  }

  join(roomId: string, uuid: string): boolean {
    const cur = this.users.get(uuid);
    if (cur !== undefined && cur !== roomId) return false;
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
    }
    room.add(uuid);
    this.users.set(uuid, roomId);
    return true;
  }

  leave(uuid: string): [string, string[]] {
    const roomId = this.users.get(uuid);
    if (roomId === undefined) return ["", []];
    this.users.delete(uuid);
    const members = this.rooms.get(roomId);
    members?.delete(uuid);
    const remaining = members ? [...members].sort() : [];
    if (!members || members.size === 0) this.rooms.delete(roomId);
    return [roomId, remaining];
  }

  members(roomId: string): string[] {
    const members = this.rooms.get(roomId);
    return members ? [...members].sort() : [];
  }
}
