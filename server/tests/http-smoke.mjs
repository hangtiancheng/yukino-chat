// HTTP flow smoke test against a running server (default :8000).
// Usage: node tests/http-smoke.mjs
import assert from "node:assert";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8000";

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
  if (expectCode !== undefined && expectCode !== null) {
    assert.equal(json.code, expectCode, `${path}: envelope ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

const rand = () => String(Date.now()).slice(-8);
const A_PHONE = `138${rand()}`;
const B_PHONE = `139${rand()}`;

// --- register ---
const a = await post("/register", { telephone: A_PHONE, password: "secret123", nickname: "Alice" });
const b = await post("/register", { telephone: B_PHONE, password: "secret123", nickname: "Bob" });
const tokenA = a.data.token;
const tokenB = b.data.token;
const uuidA = a.data.user_info.uuid;
const uuidB = b.data.user_info.uuid;
assert.match(uuidA, /^U[0-9A-Za-z]{11}$/);
assert.match(a.data.user_info.created_at, /^\d{4}\.\d{1,2}\.\d{1,2}$/);
console.log("register ok", uuidA, uuidB);

// --- login / errors ---
const bad = await post("/login", { telephone: A_PHONE, password: "wrong" }, undefined, 400);
assert.equal(bad.message, "incorrect password");
await post("/user/get-user-info", {}, undefined, 401);
const info = await post("/user/get-user-info", {}, tokenA);
assert.equal(info.data.uuid, uuidA);
console.log("auth matrix ok");

// --- search + apply + pass ---
const found = await post("/user/search-user", { keyword: B_PHONE }, tokenA);
assert.equal(found.data[0].uuid, uuidB);
assert.equal(found.data[0].is_friend, false);
await post("/contact/apply-contact", { contact_id: uuidB, contact_type: 0, message: "hi" }, tokenA);
const applies = await post("/contact/get-new-contact-list", {}, tokenB);
assert.equal(applies.data[0].user_id, uuidA);
await post("/contact/pass-contact-apply", { apply_id: applies.data[0].apply_id }, tokenB);
const contactsA = await post("/contact/get-user-list", {}, tokenA);
assert.ok(contactsA.data.some((c) => c.user_id === uuidB));
const contactsB = await post("/contact/get-user-list", {}, tokenB);
assert.ok(contactsB.data.some((c) => c.user_id === uuidA));
const foundAgain = await post("/user/search-user", { keyword: B_PHONE }, tokenA);
assert.equal(foundAgain.data[0].is_friend, true);
console.log("contact apply flow ok");

// --- contact info masking ---
const infoB = await post("/contact/get-contact-info", { contact_id: uuidB }, tokenA);
assert.ok(infoB.data.contact_phone.includes("*"));
const infoSelf = await post("/contact/get-contact-info", { contact_id: uuidA }, tokenA);
assert.equal(infoSelf.data.contact_phone, A_PHONE);
console.log("contact info masking ok");

// --- sessions ---
const s1 = await post("/session/open-session", { receive_id: uuidB }, tokenA);
const s2 = await post("/session/open-session", { receive_id: uuidB }, tokenA);
assert.equal(s1.data, s2.data, "open-session idempotent");
const sessList = await post("/session/get-user-session-list", {}, tokenA);
const bobSess = sessList.data.find((s) => s.user_id === uuidB);
assert.ok(bobSess);
// No DMs exchanged yet → empty preview, matching Go's zero-value meta.
assert.equal(bobSess.last_message_at, "");
const allowed = await post("/session/check-open-session-allowed", { receive_id: uuidB }, tokenA);
assert.equal(allowed.data, true);
await post("/session/mark-session-read", { receive_id: uuidB }, tokenA);
console.log("session flow ok");

// --- group ---
const groupName = `Test Group ${rand()}`;
const g = await post(
  "/group/create-group",
  { name: groupName, avatar: "", notice: "n", add_mode: 0, member_ids: [uuidB] },
  tokenA,
);
const groupId = g.data.uuid;
assert.match(groupId, /^G[0-9A-Za-z]{11}$/);
assert.equal(g.data.member_cnt, 2);
assert.equal(g.data.avatar, "https://vitejs.dev/logo.svg");
const myGroups = await post("/group/load-my-group", {}, tokenA);
assert.ok(myGroups.data.some((x) => x.group_id === groupId));
const joinedB = await post("/contact/load-my-joined-group", {}, tokenB);
assert.ok(joinedB.data.some((x) => x.group_id === groupId));
const gSess = await post("/session/get-group-session-list", {}, tokenB);
assert.ok(gSess.data.some((s) => s.group_id === groupId));
const gMsgs = await post("/message/get-group-message-list", { group_id: groupId }, tokenB);
assert.equal(gMsgs.data[0].content, `Welcome to ${groupName}!`);
const members = await post("/group/get-group-member-list", { group_id: groupId }, tokenA);
assert.equal(members.data.length, 2);
assert.ok(members.data.every((m) => m.is_owner === (m.user_id === uuidA)));
const searchG = await post("/group/search-group", { keyword: groupName }, tokenB);
assert.equal(searchG.data[0].is_joined, true);
const addMode = await post("/group/check-group-add-mode", { group_id: groupId }, tokenB);
assert.equal(addMode.data, 0);
console.log("group flow ok");

// --- messages (empty list → data: null) ---
const empty = await post("/message/get-message-list", { receive_id: uuidB }, tokenA);
assert.equal(empty.data, null);
// group message list includes welcome; DM list for Yukino session includes nothing yet
console.log("message list ok");

// --- admin flow (bootstrap admin via DB would be needed; verify 403) ---
await post("/user/get-user-info-list", { owner_id: uuidA }, tokenA, 403);
console.log("admin guard ok");

// --- rate limit (do last: pollutes the login bucket for this IP) ---
let saw429 = false;
for (let i = 0; i < 12; i++) {
  const r = await post("/login", { telephone: A_PHONE, password: "secret123" }, undefined, null);
  if (r.code === 429) {
    saw429 = true;
    break;
  }
}
assert.ok(saw429, "expected 429 after 10 logins/min");
console.log("rate limit ok");

console.log("\nALL HTTP SMOKE TESTS PASSED");
