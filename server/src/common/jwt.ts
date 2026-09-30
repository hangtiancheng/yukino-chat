import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenClaims {
  uuid: string;
  iat: number;
  exp: number;
}

// Same raw-base64url header bytes as the Go implementation.
const JWT_HEADER = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signToken(uuid: string, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = { uuid, iat: now, exp: now + ttlSeconds };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signing = `${JWT_HEADER}.${payload}`;
  return `${signing}.${sign(signing, secret)}`;
}

export function parseToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const signing = `${header}.${payload}`;
  const expected = Buffer.from(sign(signing, secret), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.uuid !== "string" || claims.uuid === "") return null;
  if (claims.exp > 0 && Math.floor(Date.now() / 1000) > claims.exp) return null;
  return claims;
}
