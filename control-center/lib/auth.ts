import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
const COOKIE = "rimuru_admin";
function signature(value: string, secret: string) { return createHmac("sha256", secret).update(value).digest("base64url"); }
export function verifyPassword(candidate: string) {
  const expected = process.env.RIMURU_ADMIN_PASSWORD || "";
  const a = Buffer.from(candidate); const b = Buffer.from(expected);
  return Boolean(expected) && a.length === b.length && timingSafeEqual(a,b);
}
export function makeSession() {
  const secret = process.env.RIMURU_SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("RIMURU_SESSION_SECRET must be configured.");
  const issued = String(Date.now());
  return issued + "." + signature(issued, secret);
}
export async function isAdmin() {
  const secret = process.env.RIMURU_SESSION_SECRET || "";
  if (secret.length < 32) return false;
  const jar = await cookies(); const token = jar.get(COOKIE)?.value || "";
  const [issued, sig, extra] = token.split(".");
  if (!issued || !sig || extra || !/^\d+$/.test(issued) || Date.now() - Number(issued) > 8*60*60*1000 || Number(issued) > Date.now()+60000) return false;
  const expected = Buffer.from(signature(issued,secret)); const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected,actual);
}
export const sessionCookieName = COOKIE;