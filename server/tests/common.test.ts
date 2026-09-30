import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newMessage, newUser, randomId, YUKINO_UUID } from "../src/common/ids.js";
import { parseToken, signToken } from "../src/common/jwt.js";
import { sanitizeFilename } from "../src/routes/message-routes.js";

describe("jwt", () => {
  const secret = "test-secret";

  it("round-trips claims", () => {
    const token = signToken("U1234567890a", secret, 3600);
    const claims = parseToken(token, secret);
    expect(claims?.uuid).toBe("U1234567890a");
    expect(claims?.exp).toBeGreaterThan(claims?.iat ?? 0);
  });

  it("rejects a wrong secret", () => {
    const token = signToken("U1234567890a", secret, 3600);
    expect(parseToken(token, "other")).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(parseToken("a.b", secret)).toBeNull();
    expect(parseToken("a.b.c.d", secret)).toBeNull();
    expect(parseToken("a.b.c", secret)).toBeNull();
  });

  it("supports non-expiring tokens (exp=0)", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ uuid: "U1234567890a", iat: now, exp: 0 }),
    ).toString("base64url");
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
    const signing = `${header}.${payload}`;
    const sig = createHmac("sha256", secret).update(signing).digest("base64url");
    const claims = parseToken(`${signing}.${sig}`, secret);
    expect(claims?.uuid).toBe("U1234567890a");
  });
});

describe("ids", () => {
  it("generates the prefixed shapes", () => {
    expect(newUser()).toMatch(/^U[0-9A-Za-z]{11}$/);
    expect(newMessage()).toMatch(/^M[0-9A-Za-z]{11}$/);
    expect(YUKINO_UUID).toBe("UYUKINOAGENT");
  });

  it("uses the 62-char alphabet", () => {
    for (let i = 0; i < 100; i++) {
      expect(randomId(16)).toMatch(/^[0-9A-Za-z]{16}$/);
    }
  });
});

describe("sanitizeFilename", () => {
  it("strips path traversal like Go's filepath.Base", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("/abs/path/photo.png")).toBe("photo.png");
    expect(sanitizeFilename("C:\\evil\\path.txt")).toBe("C__evil_path.txt");
  });

  it("keeps safe characters", () => {
    expect(sanitizeFilename("my-photo_2026.png")).toBe("my-photo_2026.png");
  });

  it("replaces unsafe characters", () => {
    // basename("a b/c$d.txt") strips the directory first, like Go.
    expect(sanitizeFilename("a b/c$d.txt")).toBe("c_d.txt");
  });

  it("falls back to file when empty", () => {
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });
});
