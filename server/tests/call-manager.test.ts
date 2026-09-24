import { describe, expect, it } from "vitest";
import { CallManager } from "../src/hub/call-manager.js";

describe("call manager", () => {
  it("derives room ids", () => {
    expect(CallManager.roomId("Uaaa", "Ubbb")).toBe("P:Uaaa:Ubbb");
    expect(CallManager.roomId("Ubbb", "Uaaa")).toBe("P:Uaaa:Ubbb");
    expect(CallManager.roomId("Uaaa", "G123")).toBe("G123");
  });

  it("tracks busy state across rooms", () => {
    const cm = new CallManager();
    expect(cm.join("P:a:b", "Ua")).toBe(true);
    expect(cm.isBusy("Ua")).toBe(true);
    // Busy users cannot join a different room.
    expect(cm.join("P:a:c", "Ua")).toBe(false);
    // Re-joining the same room is fine.
    expect(cm.join("P:a:b", "Ua")).toBe(true);
  });

  it("returns remaining members on leave and dissolves empty rooms", () => {
    const cm = new CallManager();
    cm.join("room", "Ub");
    cm.join("room", "Ua");
    expect(cm.members("room")).toEqual(["Ua", "Ub"]);
    const [room, remaining] = cm.leave("Ua");
    expect(room).toBe("room");
    expect(remaining).toEqual(["Ub"]);
    cm.leave("Ub");
    expect(cm.members("room")).toEqual([]);
    expect(cm.inRoom("room", "Ub")).toBe(false);
  });

  it("leaving a user in no room is a no-op", () => {
    const cm = new CallManager();
    const [room, remaining] = cm.leave("ghost");
    expect(room).toBe("");
    expect(remaining).toEqual([]);
  });
});
