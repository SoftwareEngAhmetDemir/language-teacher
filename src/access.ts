import { createHash, timingSafeEqual } from "node:crypto";

const ACCESS_CODE = process.env.ACCESS_CODE;

/** True when the server is protected by an access code (set ACCESS_CODE before exposing it publicly). */
export const requiresCode = Boolean(ACCESS_CODE);

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of a client-supplied code. Always true when no ACCESS_CODE is configured. */
export function codeOk(given: unknown): boolean {
  if (!ACCESS_CODE) return true;
  return typeof given === "string" && timingSafeEqual(digest(given), digest(ACCESS_CODE));
}
