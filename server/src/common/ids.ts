import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomId(length: number): string {
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

export const newUser = () => `U${randomId(11)}`;
export const newSession = () => `S${randomId(11)}`;
export const newGroup = () => `G${randomId(11)}`;
export const newMessage = () => `M${randomId(11)}`;
export const newTag = () => `T${randomId(11)}`;
export const newApply = () => `A${randomId(11)}`;

export const YUKINO_UUID = "UYUKINOAGENT";
export const YUKINO_NAME = "Yukino";
export const YUKINO_SIGNATURE = "Your built-in AI assistant";

export const isYukino = (uuid: string) => uuid === YUKINO_UUID;
