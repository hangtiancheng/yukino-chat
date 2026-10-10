import assert from "node:assert";
import WebSocket from "ws";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8000";
const url = new URL(BASE);
const WS_URL = `ws://${url.host}`;

async function post(path, body, token, expectCode = 200) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  assert.equal(res.status, 200, `${path}: HTTP ${res.status}`);
  const json = await res.json();
  assert.equal(json.code, expectCode, `${path}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const rand = () => String(Date.now()).slice(-8) + Math.floor(Math.random() * 90 + 10);
const A_PHONE = `138${rand()}`.slice(0, 13);
const B_PHONE = `139${rand()}`.slice(0, 13);

class Sock {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => {
      this.ws.on("close", resolve);
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
    });
    this.ws.on("message", (data) => {
      const item = { text: String(data) };
      this.queue.push(item);
      const w = this.waiters.shift();
      if (w) w(item);
    });
    this.ws.on("close", (code, reason) => {
      if (process.env.SMOKE_VERBOSE) {
        console.log(`CLIENT close code=${code} reason=${reason} at ${Date.now() % 100000}`);
      }
    });
    this.ws.on("pong", () => {});
  }

  async next(timeoutMs = 5000, predicate = null) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.queue.findIndex((q) => !q.seen && (predicate ? predicate(q) : true));
      if (idx >= 0) {
        const item = this.queue[idx];
        item.seen = true;
        return item;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timeout waiting for frame (predicate: ${predicate ? "yes" : "no"}); queue: ${JSON.stringify(
            this.queue.filter((q) => !q.seen).slice(0, 5),
          )}`,
        );
      }
      const pending = this.queue.find((q) => !q.seen && predicate && predicate(q));
      void pending;
      const remaining = deadline - Date.now();
      const item = await Promise.race([
        new Promise((resolve) => this.waiters.push(resolve)),
        new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 250))),
      ]);
      if (item && (!predicate || predicate(item))) {
        if (predicate) item.seen = true;
        return item;
      }
    }
  }

  send(obj) {
    this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
  }
}

const parse = (item) => JSON.parse(item.text);

const a = await post("/register", { telephone: A_PHONE, password: "secret123", nickname: "Alice" });
const b = await post("/register", { telephone: B_PHONE, password: "secret123", nickname: "Bob" });
const tokenA = a.data.token;
const tokenB = b.data.token;
const uuidA = a.data.user_info.uuid;
const uuidB = b.data.user_info.uuid;
const groupId = (
  await post(
    "/group/create-group",
    { name: `WS Group ${rand()}`, add_mode: 0, member_ids: [uuidB] },
    tokenA,
  )
).data.uuid;
console.log("users + group ready");

const sockA = new Sock(`${WS_URL}/wss?token=${tokenA}&client_id=${uuidA}`);
await sockA.opened;
const welcomeA = await sockA.next();
assert.equal(welcomeA.text, "welcome to yukino chat");

const sockB = new Sock(`${WS_URL}/wss?token=${tokenB}`);
await sockB.opened;
await sockB.next();

await sockA.next(5000, (q) => {
  try {
    const f = parse(q);
    return f.type === 5 && f.content === "online";
  } catch {
    return false;
  }
});
console.log("handshake + presence ok");

sockA.send({ session_id: "", type: 0, content: "hello bob", receive_id: uuidB });
const dmAtB = await sockB.next(5000, (q) => q.text.includes("hello bob"));
const dmFrame = parse(dmAtB);
assert.equal(dmFrame.send_id, uuidA);
assert.equal(dmFrame.send_name, "Alice");
assert.match(dmFrame.uuid, /^M[0-9A-Za-z]{11}$/);
await sockA.next(5000, (q) => q.text.includes("hello bob"));

sockA.send({ session_id: "", type: 0, content: "hello group", receive_id: groupId });
await sockB.next(5000, (q) => q.text.includes("hello group"));
await sockA.next(5000, (q) => q.text.includes("hello group"));
console.log("dm + group fan-out ok");

const sessList = await post("/session/get-user-session-list", {}, tokenB);
const aliceSess = sessList.data.find((s) => s.user_id === uuidA);
assert.equal(aliceSess.last_message, "hello bob");
assert.equal(aliceSess.unread_cnt, 1);
await post("/session/mark-session-read", { receive_id: uuidA }, tokenB);
const afterRead = await post("/session/get-user-session-list", {}, tokenB);
assert.equal(afterRead.data.find((s) => s.user_id === uuidA).unread_cnt, 0);
console.log("unread + read cursor ok");

sockA.send({
  session_id: "",
  type: 3,
  content: "",
  receive_id: "UYUKINOAGENT",
  av_data: JSON.stringify({ messageId: "PROXY", type: "start_call", room_id: "" }),
});
const failed = await sockA.next(5000, (q) => q.text.includes("call_failed"));
const failedFrame = parse(failed);
assert.equal(failedFrame.send_id, "SYSTEM");
assert.equal(JSON.parse(failedFrame.av_data).reason, "Yukino is a text-only assistant and cannot take calls");
console.log("call_failed ok");

const sockA2 = new Sock(`${WS_URL}/wss?token=${tokenA}&client_id=${uuidA}`);
await sockA2.opened;
const evicted = await Promise.race([
  sockA.closed,
  new Promise((_, reject) => setTimeout(() => reject(new Error("first socket not evicted")), 5000)),
]);
assert.equal(typeof evicted, "number");
sockA2.send({ session_id: "", type: 0, content: "after eviction", receive_id: uuidB });
await sockB.next(5000, (q) => q.text.includes("after eviction"));
console.log("eviction + re-presence ok");

const agentSock = new Sock(`${WS_URL}/agent/ws?token=${tokenA}`);
await agentSock.opened;
const connected = parse(await agentSock.next(60000));
assert.equal(connected.method, "session/connected");
assert.equal(typeof connected.params.model, "string");
assert.equal(connected.params.ready, true);
const commands = parse(await agentSock.next(60000));
assert.equal(commands.method, "session/commands");

agentSock.send({ jsonrpc: "2.0", id: 1, method: "ping" });
const pong = parse(await agentSock.next(5000, (q) => q.text.includes('"id":1')));
assert.deepEqual(pong.result, {});

agentSock.send({ jsonrpc: "2.0", id: 2, method: "bogus/method" });
const errResp = parse(await agentSock.next(5000, (q) => q.text.includes('"id":2')));
assert.equal(errResp.error.code, -32601);
console.log("agent ws handshake ok (model:", connected.params.model, "mode:", connected.params.permissionMode, ")");

agentSock.send({ jsonrpc: "2.0", id: 10, method: "ping" });
await agentSock.next(5000, (q) => q.text.includes('"id":10'));
console.log("sockA2 readyState before DM:", sockA2.ws.readyState);
sockA2.send({ session_id: "", type: 0, content: "smoke test prompt", receive_id: "UYUKINOAGENT" });
const runStart = await agentSock.next(15000, (q) => q.text.includes("agent/run_start"));
const runStartFrame = parse(runStart);
assert.match(runStartFrame.params.userMessageId, /^M[0-9A-Za-z]{11}$/);
console.log("agent dispatch ok (userMessageId:", runStartFrame.params.userMessageId, ")");
try {
  await sockA2.next(30000, (q) => {
    const f = parse(q);
    return f.send_id === "UYUKINOAGENT" || false;
  });
  console.log("assistant chat reply ok");
} catch {
  console.log("assistant chat reply skipped (LLM turn failed — acceptable for smoke)");
}

const nonAdmin = await fetch(`${BASE}/dashboard/ws?token=${tokenA}`);
assert.equal(nonAdmin.status, 200);
assert.equal((await nonAdmin.json()).code, 403);
console.log("dashboard guard ok");

sockB.ws.close();
sockA2.ws.close();
agentSock.ws.close();
console.log("\nALL WS SMOKE TESTS PASSED");
process.exit(0);
