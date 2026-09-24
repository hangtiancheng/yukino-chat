import { env } from "../config/env.js";
import { signToken } from "./jwt.js";

export const issueToken = (uuid: string) =>
  signToken(uuid, env.JWT_SECRET, env.TOKEN_EXPIRE_HOURS * 3600);
