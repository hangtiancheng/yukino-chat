import bcrypt from "bcryptjs";

export class PasswordTooLongError extends Error {
  constructor() {
    super("password must be at most 72 bytes");
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new PasswordTooLongError();
  }
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
